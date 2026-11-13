<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HotelTable;
use App\Models\Order;
use App\Models\OrderItem;
use App\Services\OrderService;
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
        $q = Order::with('items', 'table:id,number,section', 'waiter:id,name,role', 'bill:id,order_id,bill_no,grand_total,status')
            ->when($this->branchScope($r), fn ($q, $b) => $q->where('branch_id', $b));

        // Waiters and captains only see their own orders.
        if (in_array($r->user()->role, ['waiter', 'captain'], true)) {
            $q->where('waiter_id', $r->user()->id);
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
            $q->whereDate('created_at', $d);
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
        return Order::with('items', 'table:id,number,section', 'waiter:id,name,role', 'bill.items', 'bill.payments')->findOrFail($id);
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
        ]);
        $table = ! empty($d['table_id']) ? HotelTable::findOrFail($d['table_id']) : null;
        $branch = $table?->branch_id ?? $this->branch($r);
        // No table => it cannot be a dine-in order; treat it as takeaway.
        if (! $table && ($d['type'] ?? 'dine_in') === 'dine_in') {
            $d['type'] = 'takeaway';
        }
        $withBill = $r->boolean('generate_bill');
        abort_if($withBill && ! $r->user()->hasPermission('billing.manage'), 403, 'You cannot generate bills.');

        $order = $this->orders->place($branch, $table, $d, 'staff', $r->user());

        if ($withBill) {
            $bill = $this->orders->generateBill($order, $r->user());
            \App\Models\AuditLog::record('bill.generate', 'bill', $bill->id);
            $order->load('bill.items');
        }

        return response()->json($order, 201);
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
        $this->orders->addItems($order, $d['items']);
        $order->update(['status' => in_array($order->status, ['ready', 'served'], true) ? 'preparing' : $order->status]);

        return $order->load('items');
    }

    /** Edit an order until it is paid: send the COMPLETE new item list (quantities, removed and new dishes). */
    public function updateItems(Request $r, int $id)
    {
        $order = Order::findOrFail($id);
        abort_if(in_array($r->user()->role, ['waiter', 'captain'], true) && $order->waiter_id !== $r->user()->id, 403, 'You can only edit your own orders.');
        $d = $r->validate([
            'items' => 'required|array|min:1|max:60',
            'items.*.food_item_id' => ['required', Tenant::exists('food_items')],
            'items.*.variant_id' => ['nullable', Tenant::exists('food_item_variants')],
            'items.*.quantity' => 'required|integer|min:1|max:99',
            'notes' => 'nullable|string|max:255',
        ]);
        $order = $this->orders->replaceItems($order, $d['items']);
        if (array_key_exists('notes', $d)) {
            $order->update(['notes' => $d['notes']]);
        }
        \App\Models\AuditLog::record('order.edit', 'order', $order->id);

        return $order;
    }

    public function updateStatus(Request $r, int $id)
    {
        $order = Order::with('table')->findOrFail($id);
        $d = $r->validate(['status' => ['required', Rule::in(['accepted', 'preparing', 'ready', 'served', 'cancelled'])]]);

        // Cancelling after billing needs billing rights.
        if ($d['status'] === 'cancelled') {
            abort_unless($r->user()->hasPermission('billing.manage') || $order->status === 'pending', 403, 'You cannot cancel this order.');
            abort_if(in_array($order->status, ['billed', 'paid'], true), 422, 'Billed orders cannot be cancelled.');
        }
        abort_if(in_array($order->status, ['paid', 'cancelled'], true), 422, 'Order is closed.');

        $order->update(['status' => $d['status']]);
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
