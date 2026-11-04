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
        $q = Order::with('items', 'table:id,number', 'waiter:id,name', 'bill:id,order_id,bill_no,grand_total,status')
            ->where('branch_id', $this->branch($r));

        // Waiters only see their own orders unless they can manage billing.
        if ($r->user()->role === 'waiter') {
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

    public function show(int $id)
    {
        return Order::with('items', 'table:id,number', 'waiter:id,name', 'bill.items', 'bill.payments')->findOrFail($id);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'table_id' => ['nullable', Tenant::exists('hotel_tables')],
            'type' => 'nullable|in:dine_in,takeaway,delivery',
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

        $order = $this->orders->place($branch, $table, $d, 'staff', $r->user());

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
