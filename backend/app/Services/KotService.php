<?php

namespace App\Services;

use App\Models\FoodItem;
use App\Models\FoodItemVariant;
use App\Models\Kot;
use App\Models\KotItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use App\Support\BizTime;
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

    /**
     * Adds each slip line's Marathi dish name (`name_mr`, null when the dish has none) so a Marathi slip can print it.
     * Read only: slip lines keep storing the English name. Found through the order line's dish, else by the dish's English name
     * (a cancelled line whose order line is gone). Accepts one ticket, a list, or null; returns what it was given.
     */
    public static function withMarathiNames($kots)
    {
        $items = collect($kots instanceof Kot ? [$kots] : ($kots ?? []))->filter()->flatMap(fn (Kot $k) => $k->items);
        if ($items->isEmpty()) {
            return $kots;
        }
        $dishOf = OrderItem::whereIn('id', $items->pluck('order_item_id')->filter()->unique()->values())->pluck('food_item_id', 'id');
        $byId = FoodItem::whereIn('id', $dishOf->filter()->unique()->values())->whereNotNull('name_mr')->where('name_mr', '!=', '')->pluck('name_mr', 'id');
        $byName = FoodItem::whereIn('name', $items->pluck('name')->unique()->values())->whereNotNull('name_mr')->where('name_mr', '!=', '')->pluck('name_mr', 'name');
        // Marathi variant names (Half / Full...): found by the line's dish id (else the dish's English name) + the variant's English name
        $idByName = FoodItem::whereIn('name', $items->pluck('name')->unique()->values())->pluck('id', 'name');
        $variantMr = FoodItemVariant::whereIn('food_item_id', $dishOf->filter()->merge($idByName)->unique()->values())->whereNotNull('name_mr')->where('name_mr', '!=', '')
            ->get(['food_item_id', 'name', 'name_mr'])->mapWithKeys(fn ($v) => [$v->food_item_id.'|'.$v->name => $v->name_mr]);
        foreach (FoodItem::whereIn('id', $dishOf->filter()->merge($idByName)->unique()->values())->whereNotNull('base_variant_name')->whereNotNull('base_variant_name_mr')->where('base_variant_name_mr', '!=', '')->get(['id', 'base_variant_name', 'base_variant_name_mr']) as $d) {
            $variantMr[$d->id.'|'.$d->base_variant_name] = $d->base_variant_name_mr; // the base option's own Marathi name
        }
        foreach ($items as $i) {
            $dish = $i->order_item_id ? ($dishOf[$i->order_item_id] ?? null) : null;
            $i->setAttribute('name_mr', ($dish ? ($byId[$dish] ?? null) : null) ?? ($byName[$i->name] ?? null));
            $i->setAttribute('variant_mr', $i->variant ? ($variantMr[($dish ?? ($idByName[$i->name] ?? 0)).'|'.$i->variant] ?? null) : null);
        }

        return $kots;
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
            $today = BizTime::today();  // the kitchen's day starts at midnight in India
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

    /** The order was served or billed: its kitchen tickets are finished, so they leave the kitchen board (no order-status change). */
    public function closeTickets(Order $order): void
    {
        if (! self::enabled()) {
            return;
        }
        $order->kots()->whereIn('status', ['new', 'cooking', 'ready'])->update(['status' => 'served', 'served_at' => now()]);
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
