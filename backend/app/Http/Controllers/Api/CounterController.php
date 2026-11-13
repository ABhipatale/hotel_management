<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Bill;
use App\Models\Branch;
use App\Models\Expense;
use App\Models\HotelTable;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use App\Services\CounterService;
use App\Support\Tenant;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Owner view of a multi-counter company: every counter side by side, plus the combined total. Owner only. */
class CounterController extends Controller
{
    public function __construct(private CounterService $counters)
    {
    }

    private function owner(Request $r): void
    {
        abort_unless($r->user()->role === 'owner', 403, 'Only the owner can manage counters.');
        abort_unless(Tenant::multiCounter(), 404, 'Multiple counters are not switched on for this company.');
    }

    /** Per-counter sales, expenses and profit / loss for a period (default: today) + 7-day trend + combined total. */
    public function overview(Request $r)
    {
        $this->owner($r);
        $from = Carbon::parse($r->query('from', now()->toDateString()))->startOfDay();
        $to = Carbon::parse($r->query('to', now()->toDateString()))->endOfDay();

        $paid = fn () => Bill::where('status', 'paid')->whereBetween('created_at', [$from, $to]);
        $sales = $paid()->select('branch_id', DB::raw('SUM(grand_total) as sales'), DB::raw('SUM(tax) as tax'), DB::raw('COUNT(*) as bills'))->groupBy('branch_id')->get()->keyBy('branch_id');
        $exp = Expense::whereBetween('expense_date', [$from->toDateString(), $to->toDateString()])->select('branch_id', DB::raw('SUM(amount) as total'))->groupBy('branch_id')->pluck('total', 'branch_id');
        $orders = Order::whereBetween('created_at', [$from, $to])->where('status', '!=', 'cancelled')->select('branch_id', DB::raw('COUNT(*) as n'))->groupBy('branch_id')->pluck('n', 'branch_id');
        $open = Order::whereNotIn('status', ['paid', 'cancelled'])->select('branch_id', DB::raw('COUNT(*) as n'))->groupBy('branch_id')->pluck('n', 'branch_id');
        $tables = HotelTable::select('branch_id', DB::raw('COUNT(*) as n'))->groupBy('branch_id')->pluck('n', 'branch_id');
        $staff = User::inTenant(Tenant::id())->where('role', '!=', 'owner')->select('branch_id', DB::raw('COUNT(*) as n'))->groupBy('branch_id')->pluck('n', 'branch_id');
        $pay = Payment::whereBetween('created_at', [$from, $to])->select('branch_id', 'method', DB::raw('SUM(amount) as total'))->groupBy('branch_id', 'method')->get()->groupBy('branch_id');

        $days = collect(range(6, 0))->map(fn ($i) => now()->subDays($i)->toDateString());
        $trend = Bill::where('status', 'paid')->where('created_at', '>=', now()->subDays(6)->startOfDay())
            ->select('branch_id', DB::raw('DATE(created_at) as d'), DB::raw('SUM(grand_total) as total'))->groupBy('branch_id', DB::raw('DATE(created_at)'))->get()->groupBy('branch_id');

        $default = (int) Branch::orderByDesc('is_default')->orderBy('id')->value('id');
        $rows = Branch::orderByDesc('is_default')->orderBy('id')->get()->map(function (Branch $b) use ($sales, $exp, $orders, $open, $tables, $staff, $pay, $trend, $days, $default) {
            $s = $sales[$b->id] ?? null;
            $gross = (float) ($s->sales ?? 0);
            $tax = (float) ($s->tax ?? 0);
            $cost = (float) ($exp[$b->id] ?? 0);
            // Staff who were never given a counter work on the default one
            $team = (int) ($staff[$b->id] ?? 0) + ($b->id === $default ? (int) ($staff[null] ?? 0) : 0);

            return [
                'id' => $b->id, 'name' => $b->name, 'address' => $b->address, 'is_default' => (bool) $b->is_default, 'is_active' => (bool) $b->is_active,
                'sales' => $gross, 'tax' => $tax, 'net_sales' => round($gross - $tax, 2), 'expenses' => $cost, 'profit' => round($gross - $tax - $cost, 2),
                'bills' => (int) ($s->bills ?? 0), 'orders' => (int) ($orders[$b->id] ?? 0), 'open_orders' => (int) ($open[$b->id] ?? 0),
                'tables' => (int) ($tables[$b->id] ?? 0), 'staff' => $team,
                'payments' => collect($pay[$b->id] ?? [])->mapWithKeys(fn ($p) => [$p->method => (float) $p->total]),
                'trend' => $days->map(fn ($d) => ['date' => $d, 'total' => (float) (collect($trend[$b->id] ?? [])->firstWhere('d', $d)->total ?? 0)])->values(),
            ];
        })->values();

        $total = [
            'sales' => round($rows->sum('sales'), 2), 'tax' => round($rows->sum('tax'), 2), 'expenses' => round($rows->sum('expenses'), 2), 'profit' => round($rows->sum('profit'), 2),
            'bills' => $rows->sum('bills'), 'orders' => $rows->sum('orders'), 'open_orders' => $rows->sum('open_orders'),
        ];

        return ['from' => $from->toDateString(), 'to' => $to->toDateString(), 'counters' => $rows, 'total' => $total];
    }

    public function store(Request $r)
    {
        $this->owner($r);
        $d = $r->validate(['name' => 'required|string|max:60', 'address' => 'nullable|string|max:255']);
        $b = $this->counters->add(Tenant::company(), trim($d['name']), $d['address'] ?? null);
        AuditLog::record('counter.create', 'branch', $b->id);

        return response()->json($b->only('id', 'name', 'address', 'is_default', 'is_active'), 201);
    }

    public function update(Request $r, int $id)
    {
        $this->owner($r);
        $d = $r->validate(['name' => 'sometimes|string|max:60', 'address' => 'nullable|string|max:255', 'is_active' => 'sometimes|boolean']);
        $b = $this->counters->update(Tenant::company(), $id, $d);
        AuditLog::record('counter.update', 'branch', $b->id);

        return $b->only('id', 'name', 'address', 'is_default', 'is_active');
    }
}
