<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Order;
use App\Support\BizTime;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Reports → Entries: every order / bill / payment, so the OWNER can correct or remove a wrong one.
 * Owner only. Every change is written to the audit log first (the record of what was removed stays there).
 */
class EntriesController extends Controller
{
    private function owner(Request $r): void
    {
        abort_unless($r->user()->role === 'owner', 403, 'Only the owner can change or delete entries.');
    }

    public function index(Request $r)
    {
        $this->owner($r);
        $from = BizTime::dayStart($r->query('from', BizTime::now()->format('Y-m-d')));
        $to = BizTime::dayEnd($r->query('to', BizTime::now()->format('Y-m-d')));

        return Order::with('table:id,number', 'bill.payments')
            ->when($this->branchScope($r), fn ($q, $b) => $q->where('branch_id', $b))
            ->whereBetween('created_at', [$from, $to])
            ->latest('id')->limit(300)->get()
            ->map(fn ($o) => [
                'id' => $o->id, 'order_no' => $o->order_no, 'type' => $o->type, 'status' => $o->status,
                'table' => $o->table?->number, 'customer_name' => $o->customer_name, 'created_at' => $o->created_at,
                'bill_no' => $o->bill?->bill_no, 'bill_status' => $o->bill?->status, 'total' => $o->bill ? (float) $o->bill->grand_total : null,
                'payments' => ($o->bill?->payments ?? collect())->map(fn ($p) => ['method' => $p->method, 'amount' => (float) $p->amount, 'reference' => $p->reference])->values(),
            ]);
    }

    /** Permanently removes the order with its dishes, kitchen slips, bill and payments. */
    public function destroy(Request $r, int $id)
    {
        $this->owner($r);
        $o = Order::with('bill.payments', 'table')->findOrFail($id);
        $meta = [
            'order_no' => $o->order_no, 'bill_no' => $o->bill?->bill_no, 'status' => $o->status, 'branch_id' => $o->branch_id,
            'total' => (float) ($o->bill?->grand_total ?? 0), 'payments' => $o->bill?->payments->map(fn ($p) => $p->method.' '.$p->amount)->all() ?? [],
            'created_at' => (string) $o->created_at,
        ];
        DB::transaction(function () use ($o, $id, $meta) {
            AuditLog::record('entry.delete', 'order', $id, $meta);
            $o->delete(); // dishes, kitchen slips, bill, bill lines and payments go with it
            if ($o->table && ! Order::where('table_id', $o->table_id)->whereNotIn('status', ['paid', 'cancelled'])->exists()) {
                $o->table->update(['status' => 'available']);
            }
        });

        return response()->noContent();
    }

    /** Fix a paid entry: the day it belongs to and/or how it was paid (cash / UPI amounts must add up to the bill). */
    public function update(Request $r, int $id)
    {
        $this->owner($r);
        $d = $r->validate([
            'date' => 'nullable|date_format:Y-m-d',
            'payments' => 'nullable|array|min:1|max:5',
            'payments.*.method' => 'required_with:payments|in:cash,upi',
            'payments.*.amount' => 'required_with:payments|numeric|min:0.01',
            'payments.*.reference' => 'nullable|string|max:80',
        ]);
        $o = Order::with('bill.payments')->findOrFail($id);
        $bill = $o->bill;
        abort_unless($bill && $bill->status === 'paid', 422, 'Only paid bills can be edited.');

        if (isset($d['payments'])) {
            $sum = round(collect($d['payments'])->sum('amount'), 2);
            if ($sum !== round((float) $bill->grand_total, 2)) {
                throw ValidationException::withMessages(['payments' => 'Payments must add up to the bill total.']);
            }
        }
        $before = ['date' => (string) $o->created_at, 'payments' => $bill->payments->map(fn ($p) => $p->method.' '.$p->amount)->all()];

        DB::transaction(function () use ($d, $o, $bill) {
            if (isset($d['payments'])) {
                $first = $bill->payments->first();
                $bill->payments()->delete();
                foreach ($d['payments'] as $p) {
                    $bill->payments()->create([
                        'branch_id' => $bill->branch_id, 'method' => $p['method'], 'amount' => $p['amount'],
                        'reference' => $p['reference'] ?? null, 'received_by' => $first?->received_by,
                    ]);
                }
            }
            if (! empty($d['date'])) {
                // keep the time of day, move the day (India) — order, bill and payments together
                $day = Carbon::parse($d['date'], BizTime::tz());
                $new = fn ($ts) => Carbon::parse($ts)->setTimezone(BizTime::tz())->setDateFrom($day)->utc();
                $o->forceFill(['created_at' => $new($o->created_at)])->saveQuietly();
                $bill->forceFill(['created_at' => $new($bill->created_at)])->saveQuietly();
                $bill->payments()->get()->each(fn ($p) => $p->forceFill(['created_at' => $new($p->created_at)])->saveQuietly());
            }
        });
        AuditLog::record('entry.edit', 'order', $id, ['order_no' => $o->order_no, 'bill_no' => $bill->bill_no, 'branch_id' => $o->branch_id, 'before' => $before, 'after' => ['date' => $d['date'] ?? null, 'payments' => $d['payments'] ?? null]]);

        return response()->noContent();
    }
}
