<?php

namespace App\Services;

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

            $this->addItems($order, $data['items']);

            if ($table && in_array($table->status, ['available', 'paid', 'reserved'], true)) {
                $table->update(['status' => 'occupied']);
            }

            return $order->load('items', 'table');
        });
    }

    public function addItems(Order $order, array $items): void
    {
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
            $variantName = null;
            if (! empty($line['variant_id'])) {
                $v = $food->variants->firstWhere('id', $line['variant_id']);
                if (! $v) {
                    throw ValidationException::withMessages(['items' => 'Invalid variant.']);
                }
                $price = $v->price;
                $variantName = $v->name;
            }

            OrderItem::create([
                'order_id' => $order->id,
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
            $order->table?->update(['status' => 'billing']);

            return $bill->load('items');
        });
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
     * @param array<int, array{food_item_id:int, quantity:int, variant_id?:int|null}> $desired
     */
    public function replaceItems(Order $order, array $desired): Order
    {
        return DB::transaction(function () use ($order, $desired) {
            $order = Order::with('bill')->lockForUpdate()->findOrFail($order->id);
            abort_if(in_array($order->status, ['paid', 'cancelled'], true), 422, 'Order is closed.');
            $bill = $order->bill;
            abort_if($bill && $bill->status === 'paid', 422, 'This order is already paid.');

            $key = fn ($foodId, $variant) => $foodId.'|'.($variant ?? '');
            $wanted = [];
            foreach ($desired as $line) {
                $food = FoodItem::with('variants')->find($line['food_item_id']);
                if (! $food) {
                    throw ValidationException::withMessages(['items' => 'One or more items are unavailable.']);
                }
                $variant = null;
                if (! empty($line['variant_id'])) {
                    $v = $food->variants->firstWhere('id', $line['variant_id']);
                    if (! $v) {
                        throw ValidationException::withMessages(['items' => 'Invalid variant.']);
                    }
                    $variant = $v->name;
                }
                $k = $key($food->id, $variant);
                $wanted[$k] = ['food_item_id' => $food->id, 'variant_id' => $line['variant_id'] ?? null, 'quantity' => min(99, ($wanted[$k]['quantity'] ?? 0) + max(1, (int) $line['quantity']))];
            }

            foreach ($order->items()->where('status', '!=', 'cancelled')->get() as $item) {
                $food = $item->food_item_id ? FoodItem::find($item->food_item_id) : null;
                $k = $key($item->food_item_id, $item->variant);
                if (! isset($wanted[$k])) {
                    if ($food && $food->stock !== null) {
                        $food->increment('stock', $item->quantity); // a removed line gives its stock back
                    }
                    $item->update(['status' => 'cancelled']);

                    continue;
                }
                $delta = $wanted[$k]['quantity'] - $item->quantity;
                if ($delta !== 0) {
                    if ($food && $food->stock !== null) {
                        if ($delta > 0 && $food->stock < $delta) {
                            throw ValidationException::withMessages(['items' => "Only {$food->stock} more left of {$food->name}."]);
                        }
                        $delta > 0 ? $food->decrement('stock', $delta) : $food->increment('stock', -$delta);
                    }
                    $item->update(['quantity' => $wanted[$k]['quantity']]);
                }
                unset($wanted[$k]);
            }
            if ($wanted) {
                $this->addItems($order, array_values($wanted));
            }
            abort_if($order->items()->where('status', '!=', 'cancelled')->doesntExist(), 422, 'An order needs at least one item. Cancel the order instead.');

            if ($bill) {
                $extra = max(0.0, (float) $bill->discount - (float) $bill->items()->sum('discount'));
                [$rows, $subtotal, $discount, $tax, $grand] = $this->billTotals($order, $extra);
                $bill->items()->delete();
                foreach ($rows as $r) {
                    BillItem::create($r + ['bill_id' => $bill->id]);
                }
                $bill->update(['subtotal' => $subtotal, 'discount' => $discount, 'tax' => $tax, 'grand_total' => $grand]);
            }

            return $order->load('items', 'bill.items', 'table:id,number');
        });
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
            }

            return $bill->load('items', 'payments');
        });
    }

    private function nextNumber(string $prefix, string $model, string $column): string
    {
        $date = now()->format('ymd');
        // numbers are unique per company (not per counter), so look across every counter
        $count = $model::withoutGlobalScope('branch')->where($column, 'like', "$prefix-$date-%")->lockForUpdate()->count() + 1;

        return sprintf('%s-%s-%04d', $prefix, $date, $count);
    }
}
