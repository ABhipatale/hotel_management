<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Bill;
use App\Models\Expense;
use App\Models\HotelTable;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use App\Support\BizTime;
use App\Support\Tenant;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Every query here goes through tenant-scoped models or filters company_id explicitly. */
class ReportController extends Controller
{
    public function dashboard(Request $r)
    {
        $branch = $this->branchFilter($r);
        $today = BizTime::dayStart(BizTime::today());   // "today" and "this month" begin at midnight in India
        $month = BizTime::monthStart();

        $paid = fn () => Bill::where('status', 'paid')->when($branch, fn ($q) => $q->where('branch_id', $branch));
        $tables = HotelTable::when($branch, fn ($q) => $q->where('branch_id', $branch));
        $expenses = fn ($from) => Expense::where('expense_date', '>=', BizTime::dateOf($from))->when($branch, fn ($q) => $q->where('branch_id', $branch))->sum('amount');
        $monthSales = (float) $paid()->where('created_at', '>=', $month)->sum('grand_total');
        $monthExp = (float) $expenses($month);

        return [
            'today_sales' => (float) $paid()->where('created_at', '>=', $today)->sum('grand_total'),
            'month_sales' => $monthSales,
            'total_orders' => Order::where('created_at', '>=', $today)->when($branch, fn ($q) => $q->where('branch_id', $branch))->count(),
            'active_tables' => (clone $tables)->where('status', '!=', 'available')->count(),
            'available_tables' => (clone $tables)->where('status', 'available')->count(),
            'pending_orders' => Order::whereIn('status', ['pending', 'accepted', 'preparing'])->when($branch, fn ($q) => $q->where('branch_id', $branch))->count(),
            'today_expenses' => (float) $expenses($today),
            'month_expenses' => $monthExp,
            'month_profit' => round($monthSales - $monthExp, 2),
            'best_sellers' => $this->items($branch, $month, now())->take(5)->values(),
            'waiter_performance' => $this->waiters($branch, $month, now())->take(5)->values(),
            'payment_analytics' => $this->payments($branch, $month, now()),
            'inventory_alerts' => InventoryItem::whereColumn('quantity', '<=', 'min_quantity')->when($branch, fn ($q) => $q->where('branch_id', $branch))->get(['id', 'name', 'quantity', 'min_quantity', 'unit']),
            'sales_last_7_days' => $this->salesSeries($branch, BizTime::dayStart(BizTime::now()->subDays(6)), now(), 'day'),
        ];
    }

    public function report(Request $r, string $type)
    {
        $branch = $this->branchFilter($r);
        $from = BizTime::dayStart($r->query('from', BizTime::now()->startOfMonth()->toDateString()));
        $to = BizTime::dayEnd($r->query('to', BizTime::today()));

        return match ($type) {
            'sales' => ['group' => $g = $r->query('group', 'day'), 'rows' => $this->salesSeries($branch, $from, $to, in_array($g, ['day', 'month', 'year'], true) ? $g : 'day')],
            'tables' => $this->tables($branch, $from, $to),
            'waiters' => $this->waiters($branch, $from, $to)->values(),
            'items' => $this->items($branch, $from, $to)->values(),
            'payments' => $this->payments($branch, $from, $to),
            'expenses' => Expense::whereBetween('expense_date', [BizTime::dateOf($from), BizTime::dateOf($to)])->when($branch, fn ($q) => $q->where('branch_id', $branch))
                ->select('category', DB::raw('SUM(amount) as total'), DB::raw('COUNT(*) as entries'))->groupBy('category')->orderByDesc('total')->get(),
            'inventory' => InventoryItem::when($branch, fn ($q) => $q->where('branch_id', $branch))->orderBy('name')->get()->map(fn ($i) => $i->toArray() + ['low_stock' => $i->quantity <= $i->min_quantity]),
            'pnl' => $this->pnl($branch, $from, $to),
            'exceptions' => $this->exceptions($branch, $from, $to),
            default => abort(404),
        };
    }

    /**
     * "Discounts & voids": what the owner should look at every day. Built from the audit trail, so it also shows who did it
     * and who approved it. A counter manager sees only their own counter.
     */
    private function exceptions(?int $branch, Carbon $from, Carbon $to): array
    {
        $logs = AuditLog::where('company_id', Tenant::id())
            ->whereIn('action', ['bill.void', 'bill.generate', 'order.cancel', 'order.item_removed'])
            ->whereBetween('created_at', [$from, $to])->latest('id')->limit(500)->get()
            ->filter(fn ($l) => $branch === null || ! isset($l->meta['branch_id']) || (int) $l->meta['branch_id'] === $branch)
            ->filter(fn ($l) => $l->action !== 'bill.generate' || ! empty($l->meta['extra_discount']))
            ->values();
        $names = User::whereIn('id', $logs->pluck('user_id')->filter()->unique()->all())->pluck('name', 'id');
        $row = fn ($l) => ['at' => $l->created_at, 'by' => $names[$l->user_id] ?? '—'] + ($l->meta ?? []);
        $by = fn (string $a) => $logs->where('action', $a)->map($row)->values();

        $voids = $by('bill.void');
        $discounts = $by('bill.generate');
        $cancellations = $by('order.cancel');
        $removed = $by('order.item_removed');

        return [
            'voids' => $voids, 'discounts' => $discounts, 'cancellations' => $cancellations, 'removed' => $removed,
            'totals' => [
                'voids' => round((float) $voids->sum('total'), 2),
                'discounts' => round((float) $discounts->sum('extra_discount'), 2),
                'cancellations' => round((float) $cancellations->sum('amount'), 2),
                'removed' => round((float) $removed->sum('amount'), 2),
            ],
        ];
    }

    /**
     * Single-counter company: the whole company (as before). Multi-counter: a counter user sees only their counter
     * (also enforced by the model scope); the owner sees everything or the counter picked in the app.
     */
    private function branchFilter(Request $r): ?int
    {
        return Tenant::multiCounter() ? $this->branchScope($r) : null;
    }

    private function salesSeries(?int $branch, Carbon $from, Carbon $to, string $group): array
    {
        $rows = Bill::where('status', 'paid')->whereBetween('created_at', [$from, $to])->when($branch, fn ($q) => $q->where('branch_id', $branch))
            ->select(DB::raw(BizTime::dateSql('created_at').' as d'), DB::raw('SUM(grand_total) as sales'), DB::raw('SUM(tax) as tax'), DB::raw('SUM(discount) as discount'), DB::raw('COUNT(*) as bills'))
            ->groupBy('d')->orderBy('d')->get();

        $fmt = ['day' => 'Y-m-d', 'month' => 'Y-m', 'year' => 'Y'][$group];

        return $rows->groupBy(fn ($r) => Carbon::parse($r->d)->format($fmt))->map(fn ($g, $k) => [
            'period' => $k,
            'sales' => round($g->sum('sales'), 2),
            'tax' => round($g->sum('tax'), 2),
            'discount' => round($g->sum('discount'), 2),
            'bills' => (int) $g->sum('bills'),
        ])->values()->all();
    }

    private function items(?int $branch, Carbon $from, Carbon $to)
    {
        return OrderItem::whereHas('order', fn ($q) => $q->where('status', 'paid')->whereBetween('created_at', [$from, $to])->when($branch, fn ($w) => $w->where('branch_id', $branch)))
            ->where('status', '!=', 'cancelled')
            ->select('name', DB::raw('SUM(quantity) as qty'), DB::raw('SUM(quantity * price) as revenue'))
            ->groupBy('name')->orderByDesc('qty')->get();
    }

    private function waiters(?int $branch, Carbon $from, Carbon $to)
    {
        return Order::where('orders.status', 'paid')->whereBetween('orders.created_at', [$from, $to])->when($branch, fn ($q) => $q->where('orders.branch_id', $branch))
            ->join('bills', 'bills.order_id', '=', 'orders.id')
            ->leftJoin('users', 'users.id', '=', 'orders.waiter_id')
            ->where('bills.company_id', Tenant::id())
            ->select(DB::raw("COALESCE(users.name, 'Unassigned') as waiter"), DB::raw('COUNT(*) as orders'), DB::raw('SUM(bills.grand_total) as sales'))
            ->groupBy('waiter')->orderByDesc('sales')->get();
    }

    private function payments(?int $branch, Carbon $from, Carbon $to)
    {
        return Payment::whereBetween('created_at', [$from, $to])->when($branch, fn ($q) => $q->where('branch_id', $branch))
            ->select('method', DB::raw('SUM(amount) as total'), DB::raw('COUNT(*) as count'))->groupBy('method')->get();
    }

    private function tables(?int $branch, Carbon $from, Carbon $to)
    {
        return Order::where('orders.status', 'paid')->whereBetween('orders.created_at', [$from, $to])->when($branch, fn ($q) => $q->where('orders.branch_id', $branch))
            ->join('hotel_tables', 'hotel_tables.id', '=', 'orders.table_id')
            ->join('bills', 'bills.order_id', '=', 'orders.id')
            ->where('hotel_tables.company_id', Tenant::id())->where('bills.company_id', Tenant::id())
            ->select('hotel_tables.number as table_no', DB::raw('COUNT(*) as orders'), DB::raw('SUM(bills.grand_total) as sales'))
            ->groupBy('hotel_tables.number')->orderByDesc('sales')->get();
    }

    private function pnl(?int $branch, Carbon $from, Carbon $to): array
    {
        $sales = (float) Bill::where('status', 'paid')->whereBetween('created_at', [$from, $to])->when($branch, fn ($q) => $q->where('branch_id', $branch))->sum('grand_total');
        $tax = (float) Bill::where('status', 'paid')->whereBetween('created_at', [$from, $to])->when($branch, fn ($q) => $q->where('branch_id', $branch))->sum('tax');
        $exp = (float) Expense::whereBetween('expense_date', [BizTime::dateOf($from), BizTime::dateOf($to)])->when($branch, fn ($q) => $q->where('branch_id', $branch))->sum('amount');

        return ['sales' => $sales, 'tax_collected' => $tax, 'net_sales' => round($sales - $tax, 2), 'expenses' => $exp, 'profit' => round($sales - $tax - $exp, 2)];
    }
}
