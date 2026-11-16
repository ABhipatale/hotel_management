<?php

namespace App\Services;

use App\Models\Kot;
use App\Models\KotItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use App\Support\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Kitchen Order Tickets. Everything here is a no-op unless the platform admin switched KOT on for the company, so hotels
 * that do not use it keep the exact old flow.
 */
class KotService
{
    public static function enabled(): bool
    {
        return (bool) Tenant::company()?->kot_enabled;
    }

    /** The kitchen screen (board, chef login, "ready" alerts). Off = KOT works as printed slips only. */
    public static function screen(): bool
    {
        $c = Tenant::company();

        return (bool) $c?->kot_enabled && ($c->kot_screen ?? true) !== false;
    }

    /**
     * Sends dishes to the kitchen. $adds / $cancels are lists of ['order_item_id'?, 'name', 'variant'?, 'quantity'].
     * Dishes to cook become one "new" ticket, dishes taken off the order become one "cancel" ticket.
     */
    public function fire(Order $order, array $adds, array $cancels = [], ?User $by = null, ?string $note = null): void
    {
        if (! self::enabled() || $order->status === 'pending') {
            return;
        }
        if ($adds) {
            $this->make($order, 'new', $adds, $by, $note);
        }
        if ($cancels) {
            $this->make($order, 'cancel', $cancels, $by, null);
        }
    }

    /** @param iterable<OrderItem> $items */
    public static function lines(iterable $items): array
    {
        $out = [];
        foreach ($items as $i) {
            $out[] = ['order_item_id' => $i->id, 'name' => $i->name, 'variant' => $i->variant, 'quantity' => $i->quantity];
        }

        return $out;
    }

    /** An approved QR order (or any order that has no ticket yet): everything on it goes to the kitchen. */
    public function fireAll(Order $order, ?User $by = null): void
    {
        if (! self::enabled() || $order->kots()->exists()) {
            return;
        }
        $this->fire($order, self::lines($order->items()->where('status', '!=', 'cancelled')->get()), [], $by, $order->notes);
    }

    /** An order was cancelled while dishes were still with the kitchen: tell them to stop. */
    public function cancelOrder(Order $order, ?User $by = null): void
    {
        if (! self::enabled()) {
            return;
        }
        $open = $order->kots()->where('type', 'new')->whereIn('status', ['new', 'cooking', 'ready'])->with('items')->get();
        $lines = [];
        foreach ($open as $k) {
            foreach ($k->items as $i) {
                $lines[] = ['order_item_id' => $i->order_item_id, 'name' => $i->name, 'variant' => $i->variant, 'quantity' => $i->quantity];
            }
            $k->update(['status' => 'cancelled']);
        }
        if ($lines) {
            $this->make($order, 'cancel', $lines, $by, null);
        }
    }

    private function make(Order $order, string $type, array $lines, ?User $by, ?string $note): Kot
    {
        return DB::transaction(function () use ($order, $type, $lines, $by, $note) {
            $today = now()->toDateString();
            // one running number per day for the whole company (the kitchen reads "KOT 12", not a database id)
            $number = Kot::withoutGlobalScope('branch')->where('kot_date', $today)->lockForUpdate()->count() + 1;
            $kot = Kot::create([
                'branch_id' => $order->branch_id, 'order_id' => $order->id, 'kot_date' => $today, 'number' => $number,
                'type' => $type, 'status' => 'new', 'note' => $note ? mb_substr($note, 0, 255) : null, 'sent_by' => $by?->id,
            ]);
            foreach ($lines as $l) {
                KotItem::create(['kot_id' => $kot->id, 'order_item_id' => $l['order_item_id'] ?? null, 'name' => $l['name'], 'variant' => $l['variant'] ?? null, 'quantity' => $l['quantity']]);
            }

            return $kot;
        });
    }

    /** Moves a ticket along (new -> cooking -> ready -> served) and keeps the order, its dishes and the table in step. */
    public function setStatus(Kot $kot, string $status): Kot
    {
        return DB::transaction(function () use ($kot, $status) {
            $kot = Kot::lockForUpdate()->findOrFail($kot->id);
            $now = now();
            $stamps = ['cooking' => 'started_at', 'ready' => 'ready_at', 'served' => 'served_at'];
            $upd = ['status' => $status];
            if (isset($stamps[$status]) && ! $kot->{$stamps[$status]}) {
                $upd[$stamps[$status]] = $now;
            }
            if ($status === 'new') {
                $upd['ready_at'] = null;
            }
            $kot->update($upd);

            if ($kot->type === 'new') {
                $this->syncOrder($kot, $status);
            }

            return $kot->load('items');
        });
    }

    private function syncOrder(Kot $kot, string $status): void
    {
        $order = Order::with('table')->find($kot->order_id);
        if (! $order || in_array($order->status, ['billed', 'paid', 'cancelled'], true)) {
            return;
        }
        $itemIds = $kot->items()->whereNotNull('order_item_id')->pluck('order_item_id');
        $itemStatus = ['new' => 'pending', 'cooking' => 'preparing', 'ready' => 'ready', 'served' => 'served'][$status] ?? null;
        if ($itemStatus && $itemIds->isNotEmpty()) {
            OrderItem::whereIn('id', $itemIds)->where('status', '!=', 'cancelled')->update(['status' => $itemStatus]);
        }

        $live = $order->kots()->where('type', 'new')->whereNotIn('status', ['cancelled'])->pluck('status');
        $orderStatus = $order->status;
        if ($live->contains(fn ($s) => in_array($s, ['new', 'cooking'], true))) {
            $orderStatus = $live->contains('cooking') ? 'preparing' : ($order->status === 'pending' ? 'pending' : 'accepted');
            if ($status === 'cooking') {
                $orderStatus = 'preparing';
            }
        } elseif ($live->contains('ready')) {
            $orderStatus = 'ready';
        } elseif ($live->isNotEmpty()) {
            $orderStatus = 'served';
        }
        if ($orderStatus !== $order->status && $order->status !== 'pending') {
            $order->update(['status' => $orderStatus]);
            $map = ['preparing' => 'preparing', 'ready' => 'ready', 'served' => 'occupied'];
            if ($order->table && isset($map[$orderStatus])) {
                $order->table->update(['status' => $map[$orderStatus]]);
            }
        }
    }
}
