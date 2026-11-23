<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Employee;
use App\Models\EmployeeEntry;
use App\Models\Expense;
use App\Support\BizTime;
use App\Support\Tenant;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Staff salary & advances (pagar / uchal): the people who work in the hotel, their fixed monthly salary, advances given,
 * and the monthly salary payment (absent days cut, bonus, advance deducted). Switched on per company by the platform admin.
 * Each salary paid also lands in Expenses ("Salaries") so the profit report counts it. Advances are NOT an expense (they are money to get back).
 */
class PayrollController extends Controller
{
    private function on(): void
    {
        abort_unless(Tenant::company()?->payroll_enabled, 403, 'Salary & advances are not enabled for this hotel. Ask the platform admin to switch them on.');
    }

    private function month(Request $r): string
    {
        $m = (string) $r->query('month', BizTime::now()->format('Y-m'));

        return preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $m) ? $m : BizTime::now()->format('Y-m');
    }

    /** The people with this month's status, plus the totals for the top of the screen. */
    public function index(Request $r)
    {
        $this->on();
        $month = $this->month($r);
        $emps = Employee::orderByDesc('is_active')->orderBy('name')->get();
        $entries = EmployeeEntry::whereIn('employee_id', $emps->pluck('id'))->get()->groupBy('employee_id');

        $rows = $emps->map(function (Employee $e) use ($entries, $month) {
            $en = $entries->get($e->id, collect());
            $paid = $en->first(fn ($x) => $x->type === 'salary' && $x->month === $month);

            return $e->toArray() + [
                'balance' => round($en->where('type', 'advance')->sum('amount') - $en->where('type', 'repayment')->sum('amount') - $en->where('type', 'salary')->sum('recovery'), 2),
                'paid' => $paid,
            ];
        });
        $active = $rows->where('is_active', true);

        return [
            'month' => $month,
            'employees' => $rows->values(),
            'totals' => [
                'monthly_salary' => round($active->sum('monthly_salary'), 2),                        // what the salaries add up to every month
                'paid' => round($rows->sum(fn ($x) => $x['paid']['amount'] ?? 0), 2),               // net cash paid as salary this month
                'pending' => round($active->filter(fn ($x) => ! $x['paid'])->sum('monthly_salary'), 2), // salary not paid yet this month
                'pending_count' => $active->filter(fn ($x) => ! $x['paid'])->count(),
                'advance_balance' => round($rows->where('balance', '>', 0)->sum('balance'), 2),     // all advances still to be recovered
            ],
        ];
    }

    public function store(Request $r)
    {
        $this->on();
        $d = $this->validated($r);
        $e = Employee::create($d);
        AuditLog::record('employee.create', 'employee', $e->id);

        return response()->json($e, 201);
    }

    public function update(Request $r, int $id)
    {
        $this->on();
        $e = Employee::findOrFail($id);
        $e->update($this->validated($r, true) + ($r->has('is_active') ? ['is_active' => $r->boolean('is_active')] : []));

        return $e;
    }

    /** A person with no history is deleted; one with history is only switched off (their records stay). */
    public function destroy(int $id)
    {
        $this->on();
        $e = Employee::findOrFail($id);
        if ($e->entries()->exists()) {
            $e->update(['is_active' => false]);

            return response()->json(['deactivated' => true]);
        }
        $e->delete();

        return response()->noContent();
    }

    /** One person: details + the full ledger, newest first. */
    public function show(int $id)
    {
        $this->on();
        $e = Employee::findOrFail($id);

        return $e->toArray() + ['balance' => $e->balance(), 'entries' => $e->entries()->orderByDesc('entry_date')->orderByDesc('id')->limit(200)->get()];
    }

    public function advance(Request $r, int $id)
    {
        $this->on();
        $e = Employee::findOrFail($id);
        $d = $r->validate(['amount' => 'required|numeric|min:1|max:10000000', 'entry_date' => 'nullable|date', 'method' => 'nullable|in:cash,upi', 'note' => 'nullable|string|max:255']);
        $en = $e->entries()->create(['type' => 'advance', 'entry_date' => $d['entry_date'] ?? BizTime::today(), 'amount' => round($d['amount'], 2), 'method' => $d['method'] ?? 'cash', 'note' => $d['note'] ?? null, 'created_by' => $r->user()->id]);
        AuditLog::record('employee.advance', 'employee', $e->id, ['amount' => $en->amount]);

        return response()->json($en->toArray() + ['balance' => $e->balance()], 201);
    }

    /** The person hands money back (outside salary). */
    public function repayment(Request $r, int $id)
    {
        $this->on();
        $e = Employee::findOrFail($id);
        $d = $r->validate(['amount' => 'required|numeric|min:1|max:10000000', 'entry_date' => 'nullable|date', 'method' => 'nullable|in:cash,upi', 'note' => 'nullable|string|max:255']);
        abort_if(round($d['amount'], 2) > $e->balance(), 422, 'That is more than the advance still to be recovered.');
        $en = $e->entries()->create(['type' => 'repayment', 'entry_date' => $d['entry_date'] ?? BizTime::today(), 'amount' => round($d['amount'], 2), 'method' => $d['method'] ?? 'cash', 'note' => $d['note'] ?? null, 'created_by' => $r->user()->id]);

        return response()->json($en->toArray() + ['balance' => $e->balance()], 201);
    }

    /**
     * Pay the month's salary: base - absent days + bonus = gross; the advance recovery is taken out of it; the rest is the cash paid.
     * One salary per person per month.
     */
    public function salary(Request $r, int $id)
    {
        $this->on();
        $d = $r->validate([
            'month' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
            'absent_days' => 'nullable|numeric|min:0|max:31',
            'bonus' => 'nullable|numeric|min:0|max:10000000',
            'recovery' => 'nullable|numeric|min:0|max:10000000',
            'entry_date' => 'nullable|date',
            'method' => 'nullable|in:cash,upi',
            'note' => 'nullable|string|max:255',
        ]);
        abort_if($d['month'] > BizTime::now()->format('Y-m'), 422, 'You cannot pay the salary of a future month.');

        return DB::transaction(function () use ($r, $id, $d) {
            $e = Employee::lockForUpdate()->findOrFail($id);
            abort_unless($e->is_active, 422, 'This person is switched off.');
            abort_if($e->entries()->where('type', 'salary')->where('month', $d['month'])->exists(), 422, 'The salary for this month is already paid. Undo it first to change it.');

            $days = Carbon::createFromFormat('Y-m-d', $d['month'].'-01')->daysInMonth;
            $absent = round((float) ($d['absent_days'] ?? 0), 1);
            $base = (float) $e->monthly_salary;
            $cut = round($base / $days * $absent, 2);
            $bonus = round((float) ($d['bonus'] ?? 0), 2);
            $gross = max(0, round($base - $cut + $bonus, 2));
            $recovery = round((float) ($d['recovery'] ?? 0), 2);
            abort_if($recovery > $e->balance(), 422, 'That is more than the advance still to be recovered.');
            abort_if($recovery > $gross, 422, 'The deduction cannot be more than the salary.');
            $net = round($gross - $recovery, 2);
            $date = $d['entry_date'] ?? BizTime::today();

            $expense = $gross > 0 ? Expense::create([
                'branch_id' => $this->branch($r), 'category' => 'Salaries', 'description' => "Salary: {$e->name} ({$d['month']})",
                'amount' => $gross, 'expense_date' => $date, 'created_by' => $r->user()->id,
            ]) : null;
            $en = $e->entries()->create([
                'type' => 'salary', 'entry_date' => $date, 'amount' => $net, 'month' => $d['month'], 'base_salary' => $base, 'absent_days' => $absent,
                'absent_deduction' => $cut, 'bonus' => $bonus, 'recovery' => $recovery, 'method' => $d['method'] ?? 'cash', 'note' => $d['note'] ?? null,
                'expense_id' => $expense?->id, 'created_by' => $r->user()->id,
            ]);
            AuditLog::record('employee.salary', 'employee', $e->id, ['month' => $d['month'], 'net' => $net]);

            return response()->json($en->toArray() + ['balance' => $e->balance()], 201);
        });
    }

    /** Undo a ledger line (a wrong advance, a salary paid by mistake). A salary's expense goes with it. */
    public function destroyEntry(int $id)
    {
        $this->on();
        DB::transaction(function () use ($id) {
            $en = EmployeeEntry::findOrFail($id);
            $e = Employee::findOrFail($en->employee_id);
            if ($en->type === 'advance') {
                abort_if(round($e->balance() - $en->amount, 2) < 0, 422, 'Part of this advance was already deducted from a salary. Undo that salary first.');
            }
            $en->delete();
            if ($en->expense_id) {
                Expense::whereKey($en->expense_id)->delete();
            }
            AuditLog::record('employee.entry.delete', 'employee', $e->id, ['type' => $en->type, 'amount' => $en->amount]);
        });

        return response()->noContent();
    }

    private function validated(Request $r, bool $partial = false): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return $r->validate([
            'name' => "$req|string|max:120",
            'job' => 'nullable|string|max:60',
            'phone' => 'nullable|string|max:20',
            'monthly_salary' => "$req|numeric|min:0|max:10000000",
            'join_date' => 'nullable|date',
            'notes' => 'nullable|string|max:255',
        ]);
    }
}
