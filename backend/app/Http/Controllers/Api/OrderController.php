<?php

namespace App\Http\Controllers\Api;

use Illuminate\Support\Facades\DB;
use App\Http\Controllers\Controller;
use App\Models\HotelTable;
use App\Models\Order;
use App\Models\OrderItem;
use App\Services\KotService;
use App\Services\OrderService;
use App\Support\BizTime;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OrderController extends Controller
{
    public function __construct(private OrderService $orders)
    {
    }

    public function index(Request $r)
    {
        $q = Order::with('items.adder:id,name', 'table:id,number,section', 'waiter:id,name,role', 'bill:id,order_id,bill_no,grand_total,status')
            // tickets on each order card: with the kitchen screen (cooking / ready), and with "KOT not printed" alerts (printed or not)
            ->when(KotService::screen() || KotService::unprintedAlert(), fn ($q) => $q->with('kots:id,order_id,number,type,status,printed_at'))
            ->when($this->branchScope($r), fn ($q, $b) => $q->where('branch_id', $b));

        // Waiters and captains see their own orders PLUS every open order of a table, so whoever serves a table can see and
        // add to what a colleague already started there.
        if (in_array($r->user()->role, ['waiter', 'captain'], true)) {
            $me = $r->user()->id;
            $q->where(fn ($w) => $w->where('waiter_id', $me)->orWhere(fn ($t) => $t->whereNotNull('table_id')->whereNotIn('status', ['paid', 'cancelled'])));
        }
        if ($s = $r->query('status')) {
            $q->whereIn('status', explode(',', $s));
        }
        if ($r->boolean('open')) {
            $q->whereNotIn('status', ['paid', 'cancelled']);
        }
        if ($t = $r->query('table_id')) {
            $q->where('table_id', $t);
        }
        if ($d = $r->query('date')) {
            $q->whereBetween('created_at', [BizTime::dayStart($d), BizTime::dayEnd($d)]); // that day in India
        }

        return $q->latest()->limit(200)->get();
    }

    /**
     * Live alerts for the owner / billing counter: orders placed by OTHER people (captains, waiters, QR customers) since `after`.
     * Without `after` it only returns the newest order id so a freshly opened app does not ring for old orders.
     */
    public function feed(Request $r)
    {
        $branch = $this->branchScope($r);
        $latest = (int) Order::when($branch, fn ($q) => $q->where('branch_id', $branch))->max('id');
        if (! $r->has('after')) {
            return ['latest_id' => $latest, 'orders' => []];
        }
        $me = $r->user()->id;
        $orders = Order::with('items', 'table:id,number,section', 'waiter:id,name,role')
            ->when($branch, fn ($q) => $q->where('branch_id', $branch))
            ->where('id', '>', (int) $r->query('after'))
            ->where('created_at', '>=', now()->subDay())
            ->where('status', '!=', 'cancelled')
            ->where(fn ($q) => $q->whereNull('waiter_id')->orWhere('waiter_id', '!=', $me))
            ->orderBy('id')->limit(10)->get()
            ->map(function (Order $o) {
                $lines = $o->items->where('status', '!=', 'cancelled');

                return [
                    'id' => $o->id,
                    'order_no' => $o->order_no,
                    'type' => $o->type,
                    'source' => $o->source,
                    'table' => $o->table?->number,
                    'section' => $o->table?->section,
                    'by' => $o->waiter?->name,
                    'by_role' => $o->waiter?->role,
                    'items_count' => $lines->sum('quantity'),
                    'items' => $lines->take(3)->map(fn ($i) => $i->quantity.' x '.$i->name)->values(),
                ];
            })->values();

        return ['latest_id' => max($latest, (int) $r->query('after')), 'orders' => $orders];
    }

    public function show(int $id)
    {
        return Order::with('items.adder:id,name', 'table:id,number,section', 'waiter:id,name,role', 'bill.items', 'bill.payments')->findOrFail($id);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'table_id' => ['nullable', Tenant::exists('hotel_tables')],
            'type' => 'nullable|in:dine_in,takeaway,delivery',
            'generate_bill' => 'sometimes|boolean', // counter sale: create the order and bill it in one step
            'notes' => 'nullable|string|max:255',
            'customer_name' => 'nullable|string|max:120',
            'customer_phone' => 'nullable|string|max:20',
            'items' => 'required|array|min:1|max:60',
            'items.*.food_item_id' => ['required', Tenant::exists('food_items')],
            'items.*.variant_id' => ['nullable', Tenant::exists('food_item_variants')],
            'items.*.quantity' => 'required|integer|min:1|max:99',
            'client_ref' => 'nullable|string|max:40',   // orders saved while the device was offline: a unique reference makes a retry harmless
            'client_time' => 'nullable|date',           // when the order was really taken (offline orders reach the server later)
        ]);
        $table = ! empty($d['table_id']) ? HotelTable::findOrFail($d['table_id']) : null;
        abort_if($table?->is_split, 422, 'This table is shared. Choose one of its parts (for example '.$table?->number.'A).');
        $branch = $table?->branch_id ?? $this->branch($r);
        // No table => it cannot be a dine-in order; treat it as takeaway.
        if (! $table && ($d['type'] ?? 'dine_in') === 'dine_in') {
            $d['type'] = 'takeaway';
        }
        if ($table?->kind === 'parcel') {
            $d['type'] = 'takeaway'; // a parcel counter is never a dine-in order
        }
        $withBill = $r->boolean('generate_bill');
        abort_if($withBill && ! $r->user()->hasPermission('billing.manage'), 403, 'You cannot generate bills.');

        // The same offline order arriving twice (the first answer got lost): give back what was already created
        $ref = $d['client_ref'] ?? null;
        if ($ref && ($seen = $this->seenRef($ref))) {
            return $this->repeat($r, $seen, $withBill);
        }

        try {
            $order = DB::transaction(function () use ($branch, $table, $d, $r, $ref, $withBill) {
                $order = $this->orders->place($branch, $table, $d, 'staff', $r->user());
                if ($ref) {
                    DB::table('order_client_refs')->insert(['company_id' => Tenant::id(), 'ref' => $ref, 'order_id' => $order->id, 'created_at' => now()]);
                }
                if ($withBill) {
                    $bill = $this->orders->generateBill($order, $r->user());
                    \App\Models\AuditLog::record('bill.generate', 'bill', $bill->id);
                    $order->load('bill.items');
                }

                return $order;
            });
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            if ($ref && ($seen = $this->seenRef($ref))) {
                return $this->repeat($r, $seen, $withBill); // two copies raced: the other one won
            }
            throw $e;
        }
        $this->backdate($order, $d['client_time'] ?? null);

        if (KotService::enabled()) {
            // the ticket this order just sent to the kitchen (so the app can print its slip)
            $order->setAttribute('kot', KotService::withMarathiNames(\App\Models\Kot::with('items', 'order:id,order_no,table_id,type,notes,waiter_id', 'order.table:id,number,section', 'sender:id,name,role')->where('order_id', $order->id)->where('type', 'new')->latest('id')->first()));
        }

        return response()->json($order, 201);
    }

    private function seenRef(string $ref): ?Order
    {
        $id = DB::table('order_client_refs')->where('company_id', Tenant::id())->where('ref', $ref)->value('order_id');

        return $id ? Order::withoutGlobalScope('branch')->find($id) : null;
    }

    /** An offline order that was already saved: the same answer again (200, not a second order). Makes the bill if the first try stopped before that. */
    private function repeat(Request $r, Order $order, bool $withBill)
    {
        if ($withBill && ! $order->bill) {
            $this->orders->generateBill($order, $r->user());
        }
        $order->load('bill.items', 'items', 'table');
        if (KotService::enabled()) {
            $order->setAttribute('kot', KotService::withMarathiNames(\App\Models\Kot::with('items', 'order:id,order_no,table_id,type,notes,waiter_id', 'order.table:id,number,section', 'sender:id,name,role')->where('order_id', $order->id)->where('type', 'new')->latest('id')->first()));
        }
        $order->setAttribute('duplicate', true);

        return response()->json($order, 200);
    }

    /** An order taken offline keeps the time it was really taken (so it lands on the right day), if that time is believable. */
    private function backdate(Order $order, ?string $clientTime): void
    {
        if (! $clientTime) {
            return;
        }
        try {
            $t = \Carbon\Carbon::parse($clientTime);
        } catch (\Throwable) {
            return;
        }
        if ($t->isFuture() || $t->lt(now()->subHours(48))) {
            return; // a wrong clock on the device must not move money into another day
        }
        Order::withoutGlobalScopes()->whereKey($order->id)->update(['created_at' => $t]);
        if ($order->bill) {
            \App\Models\Bill::withoutGlobalScopes()->whereKey($order->bill->id)->update(['created_at' => $t]);
        }
    }

    /** Add more items to an open order. */
    public function addItems(Request $r, int $id)
    {
        $order = Order::findOrFail($id);
        abort_if(in_array($order->status, ['billed', 'paid', 'cancelled'], true), 422, 'Order is closed.');
        $d = $r->validate([
            'items' => 'required|array|min:1|max:60',
            'items.*.food_item_id' => ['required', Tenant::exists('food_items')],
            'items.*.variant_id' => ['nullable', Tenant::exists('food_item_variants')],
            'items.*.quantity' => 'required|integer|min:1|max:99',
        ]);
        $added = $this->orders->addItems($order, $d['items'], $r->user());
        app(KotService::class)->fire($order, KotService::lines($added), [], $r->user());
        $order->update(['status' => in_array($order->status, ['ready', 'served'], true) ? 'preparing' : $order->status]);

        return $order->load('items');
    }

    /**
     * Edit an order until it is paid: send the COMPLETE new item list (quantities, removed and new dishes).
     * Optional (app since 2026-11-24): `base` = the list the screen loaded, so only the screen's changes are applied (see
     * OrderService::replaceItems), and `kot_note` = a note for the kitchen slip of the added dishes (added to the order's notes).
     * The answer then also carries `kot` / `kots`: the kitchen slips this save sent, so the app can print them.
     */
    public function updateItems(Request $r, int $id)
    {
        $order = Order::findOrFail($id);
        abort_if(in_array($r->user()->role, ['waiter', 'captain'], true) && $order->waiter_id !== $r->user()->id && ! $order->table_id, 403, 'You can only edit your own orders.');
        $d = $r->validate([
            'items' => 'required|array|min:1|max:60',
            'items.*.food_item_id' => ['required', Tenant::exists('food_items')],
            'items.*.variant_id' => ['nullable', Tenant::exists('food_item_variants')],
            'items.*.quantity' => 'required|integer|min:1|max:99',
            'notes' => 'nullable|string|max:255',
            'base' => 'sometimes|array|max:200',
            'base.*.food_item_id' => ['required', Tenant::exists('food_items')],
            'base.*.variant_id' => ['nullable', Tenant::exists('food_item_variants')],
            'base.*.quantity' => 'required|integer|min:1|max:999',
            'kot_note' => 'nullable|string|max:255',
            'client_ref' => 'nullable|string|max:36', // one save = one reference: tapping Save again after a lost answer never adds the dishes twice
        ]);
        $ref = isset($d['client_ref']) ? 'e:'.$d['client_ref'] : null; // "e:" keeps edit references apart from offline-order ones
        $seen = fn () => $ref && DB::table('order_client_refs')->where('company_id', Tenant::id())->where('ref', $ref)->exists();
        $already = fn () => Order::with('items', 'bill.items', 'table:id,number')->findOrFail($order->id);
        if ($seen()) {
            return $already();
        }
        $lastKot = (int) \App\Models\Kot::where('order_id', $order->id)->max('id');
        try {
            $order = DB::transaction(function () use ($order, $d, $r, $ref) {
                if ($ref) {
                    DB::table('order_client_refs')->insert(['company_id' => Tenant::id(), 'ref' => $ref, 'order_id' => $order->id, 'created_at' => now()]);
                }

                return $this->orders->replaceItems($order, $d['items'], $r->user(), array_key_exists('base', $d) ? $d['base'] : null, $d['kot_note'] ?? null);
            });
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            if ($seen()) {
                return $already(); // two copies of one save raced: the other one did it
            }
            throw $e;
        }
        if (array_key_exists('notes', $d)) {
            $order->update(['notes' => $d['notes']]);
        }
        \App\Models\AuditLog::record('order.edit', 'order', $order->id);

        if (KotService::enabled()) {
            // the slips this save sent to the kitchen (new dishes, and a cancel slip for reduced ones), for printing on this device
            $kots = KotService::withMarathiNames(\App\Models\Kot::with('items', 'order:id,order_no,table_id,type,notes,waiter_id', 'order.table:id,number,section', 'sender:id,name,role')
                ->where('order_id', $order->id)->where('id', '>', $lastKot)->orderBy('id')->get());
            $order->setAttribute('kots', $kots->values());
            $order->setAttribute('kot', $kots->firstWhere('type', 'new'));
        }

        return $order;
    }

    public function updateStatus(Request $r, int $id)
    {
        $order = Order::with('table')->findOrFail($id);
        $d = $r->validate(['status' => ['required', Rule::in(['accepted', 'preparing', 'ready', 'served', 'cancelled'])], 'reason' => 'nullable|string|min:3|max:120']);

        // Cancelling after billing needs billing rights.
        if ($d['status'] === 'cancelled') {
            abort_unless($r->user()->hasPermission('billing.manage') || $order->status === 'pending', 403, 'You cannot cancel this order.');
            abort_if(in_array($order->status, ['billed', 'paid'], true), 422, 'Billed orders cannot be cancelled.');
        }
        abort_if(in_array($order->status, ['paid', 'cancelled'], true), 422, 'Order is closed.');

        // Cancelling an order the kitchen already started (food made or served) needs the owner's approval PIN, once the owner has set one
        $before = $order->status;
        $approved = null;
        $amount = 0.0;
        if ($d['status'] === 'cancelled') {
            if (in_array($before, ['preparing', 'ready', 'served'], true)) {
                $approved = app(\App\Services\ApprovalService::class)->requireIfConfigured($r, 'Cancelling an order that the kitchen already started');
            }
            $amount = $this->orders->grossSubtotal($order);
        }

        $order->update(['status' => $d['status']]);
        if ($d['status'] === 'cancelled' && ($before !== 'pending' || ! empty($d['reason']))) {
            \App\Models\AuditLog::record('order.cancel', 'order', $order->id, ['order_no' => $order->order_no, 'branch_id' => $order->branch_id, 'status_before' => $before, 'amount' => $amount, 'approved' => $approved, 'reason' => $d['reason'] ?? null]);
        }
        if ($d['status'] === 'served') {
            app(KotService::class)->closeTickets($order); // a served order's tickets leave the kitchen board
        }
        if ($d['status'] === 'accepted') {
            app(KotService::class)->fireAll($order, $r->user()); // an approved customer (QR) order goes to the kitchen now
        }
        if ($d['status'] === 'cancelled') {
            app(KotService::class)->cancelOrder($order, $r->user());
        }
        $itemStatus = match ($d['status']) {
            'preparing' => 'preparing', 'ready' => 'ready', 'served' => 'served', 'cancelled' => 'cancelled', default => null,
        };
        if ($itemStatus) {
            $order->items()->where('status', '!=', 'cancelled')->update(['status' => $itemStatus]);
        }

        if ($order->table) {
            $map = ['preparing' => 'preparing', 'ready' => 'ready', 'served' => 'occupied'];
            if (isset($map[$d['status']])) {
                $order->table->update(['status' => $map[$d['status']]]);
            } elseif ($d['status'] === 'cancelled') {
                $open = Order::where('table_id', $order->table_id)->whereNotIn('status', ['paid', 'cancelled'])->exists();
                $order->table->update(['status' => $open ? 'occupied' : 'available']);
                $order->table->mergeIfIdle();
            }
        }

        return $order->load('items');
    }

    public function updateItemStatus(Request $r, int $id)
    {
        $item = OrderItem::findOrFail($id);
        $d = $r->validate(['status' => ['required', Rule::in(['pending', 'preparing', 'ready', 'served', 'cancelled'])]]);
        abort_if(in_array($item->order->status, ['billed', 'paid'], true), 422, 'Order is billed.');
        $item->update($d);

        return $item;
    }
}
