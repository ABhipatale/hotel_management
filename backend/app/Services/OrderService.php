<?php

namespace App\Services;

use App\Support\BizTime;
use App\Models\Bill;
use App\Models\BillItem;
use App\Models\Customer;
use App\Models\FoodItem;
use App\Models\HotelTable;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use App\Support\Tenant;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** All money maths happens here, server-side, from DB prices — never from client-sent prices. */
class OrderService
{
    /**
     * @param array{items: array<int, array{food_item_id:int, quantity:int, variant_id?:int|null}>, type?:string, notes?:string, customer_name?:string, customer_phone?:string} $data
     */
    public function place(int $branchId, ?HotelTable $table, array $data, string $source = 'staff', ?User $waiter = null): Order
    {
        return DB::transaction(function () use ($branchId, $table, $data, $source, $waiter) {
            // One order per table: a waiter / captain ordering for a table that already has an open, not-yet-billed order
            // adds to THAT order (one order number, one bill). Customer QR orders still arrive separately for approval.
            if ($table && $source === 'staff') {
                $open = Order::where('table_id', $table->id)->whereIn('status', ['pending', 'accepted', 'preparing', 'ready', 'served'])
                    ->whereDoesntHave('bill')->oldest('id')->lockForUpdate()->first();
                if ($open) {
                    $added = $this->addItems($open, $data['items'], $waiter);
                    $updates = [];
                    if (in_array($open->status, ['ready', 'served'], true)) {
                        $updates['status'] = 'preparing'; // new dishes are on their way
                    }
                    if (! empty($data['notes'])) {
                        $updates['notes'] = trim(($open->notes ? $open->notes.' | ' : '').$data['notes']);
                    }
                    if ($updates) {
                        $open->update($updates);
                    }
                    $table->update(['status' => 'occupied']);
                    app(KotService::class)->fire($open, KotService::lines($added), [], $waiter, $data['notes'] ?? null);

                    return tap($open->load('items.adder:id,name', 'table'), fn (Order $o) => $o->setAttribute('merged', true));
                }
            }

            $customerId = null;
            if (! empty($data['customer_phone'])) {
                $customerId = Customer::firstOrCreate(['phone' => $data['customer_phone']], ['name' => $data['customer_name'] ?? null])->id;
            }

            $order = Order::create([
                'branch_id' => $branchId,
                'order_no' => $this->nextNumber('ORD', Order::class, 'order_no'),
                'table_id' => $table?->id,
                'waiter_id' => $waiter?->id ?? $table?->waiter_id,
                'customer_id' => $customerId,
                'type' => $data['type'] ?? ($table ? 'dine_in' : 'takeaway'),
                'source' => $source,
                'status' => $source === 'qr' ? 'pending' : 'accepted', // no kitchen step: staff orders are active immediately
                'customer_name' => $data['customer_name'] ?? null,
                'customer_phone' => $data['customer_phone'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);

            $added = $this->addItems($order, $data['items'], $waiter);

            if ($table && in_array($table->status, ['available', 'paid', 'reserved'], true)) {
                $table->update(['status' => 'occupied']);
            }

            if ($source === 'staff') {
                app(KotService::class)->fire($order, KotService::lines($added), [], $waiter, $data['notes'] ?? null);
            }

            return $order->load('items', 'table');
        });
    }

    /** @return array<int, OrderItem> the lines that were created */
    public function addItems(Order $order, array $items, ?User $by = null): array
    {
        $created = [];
        foreach ($items as $line) {
            // Scoped lookup: another tenant's item id simply does not exist here.
            $food = FoodItem::with('variants')->where('is_available', true)->find($line['food_item_id']);
            if (! $food) {
                throw ValidationException::withMessages(['items' => 'One or more items are unavailable.']);
            }
            if ($food->branch_id && $food->branch_id !== $order->branch_id) {
                throw ValidationException::withMessages(['items' => "{$food->name} is not served at this branch."]);
            }
            $qty = max(1, (int) $line['quantity']);
            if ($food->stock !== null && $food->stock < $qty) {
                throw ValidationException::withMessages(['items' => "Only {$food->stock} left of {$food->name}."]);
            }

            $price = $food->price;
            $variantName = $food->baseVariantLabel(); // the owner's name for the base option ("Half"), null = plain "Regular"
            if (! empty($line['variant_id'])) {
                $v = $food->variants->firstWhere('id', $line['variant_id']);
                if (! $v) {
                    throw ValidationException::withMessages(['items' => 'Invalid variant.']);
                }
                $price = $v->price;
                $variantName = $v->name;
            }

            $created[] = OrderItem::create([
                'order_id' => $order->id,
                'added_by' => $by?->id,
                'food_item_id' => $food->id,
                'name' => $food->name,
                'variant' => $variantName,
                'quantity' => $qty,
                'price' => $price,
                'gst_percent' => Tenant::company()?->gst_enabled === false ? 0 : $food->gst_percent,
                'discount_percent' => $food->discount_percent,
            ]);

            if ($food->stock !== null) {
                $food->decrement('stock', $qty);
            }
        }

        return $created;
    }

    public function generateBill(Order $order, ?User $by = null, float $extraDiscount = 0): Bill
    {
        return DB::transaction(function () use ($order, $by, $extraDiscount) {
            if ($order->bill) {
                return $order->bill->load('items');
            }
            [$rows, $subtotal, $discount, $tax, $grand] = $this->billTotals($order, $extraDiscount);

            $bill = Bill::create([
                'branch_id' => $order->branch_id,
                'order_id' => $order->id,
                'bill_no' => $this->nextNumber('BILL', Bill::class, 'bill_no'),
                'subtotal' => $subtotal,
                'discount' => $discount,
                'tax' => $tax,
                'grand_total' => $grand,
                'created_by' => $by?->id,
            ]);
            foreach ($rows as $r) {
                BillItem::create($r + ['bill_id' => $bill->id]);
            }
            $order->update(['status' => 'billed']);
            app(KotService::class)->closeTickets($order); // a billed order's tickets leave the kitchen board
            $order->table?->update(['status' => 'billing']);

            return $bill->load('items');
        });
    }

    /** Sets the extra (whole-bill) discount of an unpaid bill, replacing an earlier one. Item discounts and tax stay as they are. */
    public function setBillDiscount(Bill $bill, float $extra): Bill
    {
        return DB::transaction(function () use ($bill, $extra) {
            $bill = Bill::lockForUpdate()->findOrFail($bill->id);
            abort_if($bill->status !== 'unpaid', 422, 'Bill is not payable.');
            $itemDiscount = round((float) $bill->items()->sum('discount'), 2);
            $extra = max(0.0, min($extra, round((float) $bill->subtotal - $itemDiscount, 2)));
            $discount = round($itemDiscount + $extra, 2);
            $bill->update(['discount' => $discount, 'grand_total' => round((float) $bill->subtotal - $discount + (float) $bill->tax, 2)]);

            return $bill->load('items');
        });
    }

    /** What the (not cancelled) dishes of an order add up to, before any discount: the base for the staff discount limit. */
    public function grossSubtotal(Order $order): float
    {
        return round($order->items()->where('status', '!=', 'cancelled')->get()->sum(fn ($i) => $i->price * $i->quantity), 2);
    }

    /** @return array{0: array<int, array<string, mixed>>, 1: float, 2: float, 3: float, 4: float} [bill lines, subtotal, discount, tax, grand total] */
    private function billTotals(Order $order, float $extraDiscount): array
    {
        $items = $order->items()->where('status', '!=', 'cancelled')->get();
        abort_if($items->isEmpty(), 422, 'Order has no billable items.');

        $subtotal = $discount = $tax = 0.0;
        $gstOn = Tenant::company()?->gst_enabled !== false;
        $rows = [];
        foreach ($items as $i) {
            $gross = round($i->price * $i->quantity, 2);
            $disc = round($gross * $i->discount_percent / 100, 2);
            // GST switched off => no tax, even for items added while it was still on
            $t = $gstOn ? round(($gross - $disc) * $i->gst_percent / 100, 2) : 0.0;
            $subtotal += $gross;
            $discount += $disc;
            $tax += $t;
            $rows[] = ['name' => $i->name.($i->variant ? " ({$i->variant})" : ''), 'quantity' => $i->quantity, 'price' => $i->price, 'discount' => $disc, 'tax' => $t, 'total' => $gross - $disc + $t];
        }
        $discount += min($extraDiscount, $subtotal - $discount);

        return [$rows, $subtotal, $discount, $tax, round($subtotal - $discount + $tax, 2)];
    }

    /**
     * Replaces the order's lines with `$desired` (the COMPLETE new list: food_item_id, variant_id?, quantity).
     * Allowed until the order is paid. Quantities change, missing lines are cancelled, new lines are added, tracked stock is kept
     * in step, and an unpaid bill is rebuilt in place (same bill number, any extra discount kept).
     *
     * With `$base` (the dishes the screen loaded; sent by the app since 2026-11-24) only the screen's own changes are applied
     * on top of what the order holds NOW: a dish a colleague added meanwhile is kept, and a line the screen could not show
     * exactly (e.g. an option renamed since) is left alone. Without it (older app) the order becomes exactly `$desired`.
     *
     * @param array<int, array{food_item_id:int, quantity:int, variant_id?:int|null}> $desired
     * @param array<int, array{food_item_id:int, quantity:int, variant_id?:int|null}>|null $base
     */
    public function replaceItems(Order $order, array $desired, ?User $by = null, ?array $base = null, ?string $kotNote = null): Order
    {
        return DB::transaction(function () use ($order, $desired, $by, $base, $kotNote) {
            $order = Order::with('bill', 'table')->lockForUpdate()->findOrFail($order->id);
            abort_if(in_array($order->status, ['paid', 'cancelled'], true), 422, 'Order is closed.');
            $bill = $order->bill;
            abort_if($bill && $bill->status === 'paid', 422, 'This order is already paid.');

            $key = fn ($foodId, $variant) => $foodId.'|'.($variant ?? '');
            $wanted = $this->linesByKey($desired, $key, 99);
            // The order's active lines per dish + option. One dish can be on several lines (added again later at a busy table),
            // so lines are compared per dish, never line by line: that sent the kitchen a wrong "+1" and "cancel 1" (error B19).
            $rows = $order->items()->where('status', '!=', 'cancelled')->orderBy('id')->get()->groupBy(fn ($i) => $key($i->food_item_id, $i->variant));

            if ($base !== null) {
                $before = $this->linesByKey($base, $key, null);
                foreach (array_unique(array_merge(array_keys($wanted), array_keys($before), $rows->keys()->all())) as $k) {
                    $now = (int) ($rows->has($k) ? $rows->get($k)->sum('quantity') : 0);
                    $q = $now + ($wanted[$k]['quantity'] ?? 0) - ($before[$k]['quantity'] ?? 0);
                    if ($q > 0) {
                        $wanted[$k] = ['food_item_id' => $wanted[$k]['food_item_id'] ?? $before[$k]['food_item_id'] ?? null, 'variant_id' => $wanted[$k]['variant_id'] ?? $before[$k]['variant_id'] ?? null, 'quantity' => $q];
                    } else {
                        unset($wanted[$k]);
                    }
                }
            }

            $kotAdd = $kotCancel = $removed = [];
            foreach ($rows as $k => $lines) {
                $delta = ($wanted[$k]['quantity'] ?? 0) - (int) $lines->sum('quantity');
                unset($wanted[$k]);
                if ($delta === 0) {
                    continue;
                }
                $food = $lines->first()->food_item_id ? FoodItem::find($lines->first()->food_item_id) : null;
                if ($delta > 0) {
                    if ($food && $food->stock !== null) {
                        if ($food->stock < $delta) {
                            throw ValidationException::withMessages(['items' => "Only {$food->stock} more left of {$food->name}."]);
                        }
                        $food->decrement('stock', $delta);
                    }
                    $item = $lines->last(); // more of a dish goes on its newest line
                    $item->update(['quantity' => $item->quantity + $delta]);
                    $kotAdd[] = ['order_item_id' => $item->id, 'name' => $item->name, 'variant' => $item->variant, 'quantity' => $delta];

                    continue;
                }
                // fewer: taken off the newest lines first (the ones the kitchen is least likely to have made already)
                $left = -$delta;
                foreach ($lines->reverse() as $item) {
                    if ($left <= 0) {
                        break;
                    }
                    $take = min($left, (int) $item->quantity);
                    $left -= $take;
                    $take === (int) $item->quantity ? $item->update(['status' => 'cancelled']) : $item->update(['quantity' => $item->quantity - $take]);
                    if ($food && $food->stock !== null) {
                        $food->increment('stock', $take); // a removed dish gives its stock back
                    }
                    $kotCancel[] = ['order_item_id' => $item->id, 'name' => $item->name, 'variant' => $item->variant, 'quantity' => $take];
                    $removed[] = ['name' => $item->name, 'qty' => $take, 'amount' => round($item->price * $take, 2)];
                }
            }
            if ($wanted) {
                $kotAdd = array_merge($kotAdd, KotService::lines($this->addItems($order, array_values($wanted), $by)));
            }
            abort_if($order->items()->where('status', '!=', 'cancelled')->doesntExist(), 422, 'An order needs at least one item. Cancel the order instead.');

            // Adding to a running order (the app's table / edit screen): the same as adding from New order used to do
            if ($base !== null && $kotAdd) {
                if (in_array($order->status, ['ready', 'served'], true)) {
                    $order->update(['status' => 'preparing']); // new dishes are on their way
                }
                if (! $bill) {
                    $order->table?->update(['status' => 'occupied']);
                }
            }
            $kotNote = trim((string) $kotNote) ?: null;
            if ($kotNote) {
                $order->update(['notes' => trim(($order->notes ? $order->notes.' | ' : '').$kotNote)]);
            }

            if ($bill) {
                $extra = max(0.0, (float) $bill->discount - (float) $bill->items()->sum('discount'));
                [$rows, $subtotal, $discount, $tax, $grand] = $this->billTotals($order, $extra);
                $bill->items()->delete();
                foreach ($rows as $r) {
                    BillItem::create($r + ['bill_id' => $bill->id]);
                }
                $bill->update(['subtotal' => $subtotal, 'discount' => $discount, 'tax' => $tax, 'grand_total' => $grand]);
            }

            app(KotService::class)->fire($order, $kotAdd, $kotCancel, $by, $kotNote);

            // Dishes taken off an order the kitchen has already started: remembered for the owner's "Discounts & voids" report
            if ($removed && $by && in_array($order->status, ['preparing', 'ready', 'served'], true)) {
                \App\Models\AuditLog::record('order.item_removed', 'order', $order->id, [
                    'order_no' => $order->order_no, 'branch_id' => $order->branch_id, 'items' => $removed, 'amount' => round(array_sum(array_column($removed, 'amount')), 2),
                ], $by);
            }

            return $order->load('items', 'bill.items', 'table:id,number');
        });
    }

    /**
     * The screen's lines as [dish|option => line]; the same dish + option sent twice is added up.
     *
     * @return array<string, array{food_item_id:int, variant_id:int|null, quantity:int}>
     */
    private function linesByKey(array $lines, callable $key, ?int $cap): array
    {
        $out = [];
        foreach ($lines as $line) {
            $food = FoodItem::with('variants')->find($line['food_item_id']);
            if (! $food) {
                throw ValidationException::withMessages(['items' => 'One or more items are unavailable.']);
            }
            $variant = $food->baseVariantLabel();
            if (! empty($line['variant_id'])) {
                $v = $food->variants->firstWhere('id', $line['variant_id']);
                if (! $v) {
                    throw ValidationException::withMessages(['items' => 'Invalid variant.']);
                }
                $variant = $v->name;
            }
            $k = $key($food->id, $variant);
            $qty = ($out[$k]['quantity'] ?? 0) + max(1, (int) $line['quantity']);
            $out[$k] = ['food_item_id' => $food->id, 'variant_id' => $line['variant_id'] ?? null, 'quantity' => $cap ? min($cap, $qty) : $qty];
        }

        return $out;
    }

    /** Records payment(s); marks bill/order paid and frees the table once fully settled. */
    public function pay(Bill $bill, array $payments, ?User $by = null): Bill
    {
        return DB::transaction(function () use ($bill, $payments, $by) {
            $bill = Bill::lockForUpdate()->findOrFail($bill->id);
            abort_if($bill->status !== 'unpaid', 422, 'Bill is not payable.');

            $total = 0;
            foreach ($payments as $p) {
                Payment::create([
                    'branch_id' => $bill->branch_id,
                    'bill_id' => $bill->id,
                    'method' => $p['method'],
                    'amount' => $p['amount'],
                    'reference' => $p['reference'] ?? null,
                    'received_by' => $by?->id,
                ]);
                $total += $p['amount'];
            }
            if (round($total, 2) < round($bill->grand_total, 2)) {
                throw ValidationException::withMessages(['payments' => 'Payment is less than the bill total.']);
            }
            if (round($total, 2) > round($bill->grand_total, 2)) {
                throw ValidationException::withMessages(['payments' => 'Payment is more than the bill total.']);
            }

            $bill->update(['status' => 'paid']);
            $order = $bill->order;
            $order->update(['status' => 'paid']);
            $order->items()->where('status', '!=', 'cancelled')->update(['status' => 'served']);
            if ($order->table) {
                $open = Order::where('table_id', $order->table_id)->whereNotIn('status', ['paid', 'cancelled'])->exists();
                $order->table->update(['status' => $open ? 'occupied' : 'available']);
                $order->table->mergeIfIdle(); // a shared table closes once both parts are settled
            }

            return $bill->load('items', 'payments');
        });
    }

    private function nextNumber(string $prefix, string $model, string $column): string
    {
        $date = BizTime::now()->format('ymd');   // the day number restarts at midnight in India
        // numbers are unique per company (not per counter), so look across every counter
        // highest number used today + 1 (not "how many there are": a voided / deleted bill would make the next number repeat)
        $last = $model::withoutGlobalScope('branch')->where($column, 'like', "$prefix-$date-%")->lockForUpdate()->pluck($column)
            ->map(fn ($n) => (int) substr((string) $n, strrpos((string) $n, '-') + 1))->max() ?? 0;

        return sprintf('%s-%s-%04d', $prefix, $date, $last + 1);
    }
}
