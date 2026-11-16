<?php

namespace App\Http\Controllers\Api;

use App\Support\BizTime;
use App\Http\Controllers\Controller;
use App\Models\Kot;
use App\Services\KotService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Kitchen screen: live tickets, moving them along, and "ready" alerts for waiters. Off unless the company has KOT enabled. */
class KotController extends Controller
{
    /** $screen: the kitchen board / alerts / status need the kitchen screen; marking a slip printed only needs KOT itself. */
    private function guard(bool $screen = true): void
    {
        abort_unless(KotService::enabled(), 403, 'Kitchen tickets (KOT) are not enabled for this hotel.');
        abort_if($screen && ! KotService::screen(), 403, 'The kitchen screen is not enabled for this hotel.');
    }

    /** Every ticket query goes through here: a chef sees only the counters they were given, the owner follows the counter pills. */
    private function scoped(Request $r)
    {
        $chef = $r->attributes->get('kitchen_branches');

        return Kot::query()->when($chef, fn ($q) => $q->whereIn('branch_id', $chef), fn ($q) => $q->when($this->branchScope($r), fn ($w, $b) => $w->where('branch_id', $b)));
    }

    private function base(Request $r)
    {
        return $this->scoped($r)->with('items', 'order:id,order_no,table_id,type,notes,waiter_id', 'order.table:id,number,section', 'sender:id,name,role');
    }

    /** Kitchen board: every ticket still in progress plus what was finished in the last hour. `done=1` lists today's finished ones. */
    public function index(Request $r)
    {
        $this->guard();
        $q = $this->base($r);
        if ($r->boolean('done')) {
            $q->whereIn('status', ['served', 'cancelled'])->where('kot_date', BizTime::today())->latest('id')->limit(100);
        } else {
            $q->where(fn ($w) => $w->whereIn('status', ['new', 'cooking', 'ready'])->orWhere(fn ($x) => $x->where('status', 'served')->where('served_at', '>=', now()->subHour())))
                ->orderBy('id');
        }

        return $q->get();
    }

    /**
     * Waiters / captains / owner: tickets that became ready at or after `since` (a timestamp watermark; the app skips ids it already showed). Without `since` it only returns the newest
     * watermark, so a freshly opened app never rings for old tickets. Staff are alerted about their own tables; owner / billing about all.
     */
    public function ready(Request $r)
    {
        $this->guard();
        $branch = $this->branchScope($r);
        $r->validate(['since' => 'nullable|string|max:40']);

        $since = $r->query('since');
        $newest = Kot::when($branch, fn ($q) => $q->where('branch_id', $branch))->where('type', 'new')->whereNotNull('ready_at')->max('ready_at');
        if (! $since) {
            return ['since' => $newest ? (string) $newest : now()->toDateTimeString(), 'kots' => []];
        }
        $me = $r->user();
        $own = in_array($me->role, ['waiter', 'captain'], true);
        $kots = $this->base($r)->where('type', 'new')->where('ready_at', '>=', $since)
            ->when($own, fn ($q) => $q->where(fn ($w) => $w->where('sent_by', $me->id)->orWhereHas('order', fn ($o) => $o->where('waiter_id', $me->id))))
            ->orderBy('ready_at')->limit(10)->get()
            ->map(fn (Kot $k) => [
                'id' => $k->id, 'number' => $k->number, 'order_no' => $k->order?->order_no, 'table' => $k->order?->table?->number,
                'items' => $k->items->take(3)->map(fn ($i) => $i->quantity.' x '.$i->name)->values(), 'items_count' => $k->items->sum('quantity'),
            ])->values();

        return ['since' => (string) ($newest ?: $since), 'kots' => $kots];
    }

    public function status(Request $r, int $id)
    {
        $this->guard();
        $kot = $this->scoped($r)->findOrFail($id);
        $d = $r->validate(['status' => ['required', Rule::in(['new', 'cooking', 'ready', 'served'])]]);
        // The kitchen moves tickets along; waiters / billing may only mark a ticket served (collected).
        $kitchen = $r->user()->hasPermission('orders.kitchen');
        abort_unless($kitchen || $d['status'] === 'served', 403, 'Only the kitchen can do this.');
        abort_if($kot->status === 'cancelled', 422, 'This ticket was cancelled.');
        // A "stop cooking" ticket has nothing to cook: it is just acknowledged
        abort_if($kot->type === 'cancel' && $d['status'] !== 'served', 422, 'Acknowledge this ticket.');

        return app(KotService::class)->setStatus($kot, $d['status'])->load('order.table:id,number,section');
    }

    /** Remember that a slip was printed (so the screen can show it). */
    public function printed(Request $r, int $id)
    {
        $this->guard(false);
        $this->scoped($r)->findOrFail($id)->update(['printed_at' => now()]);

        return ['ok' => true];
    }
}
