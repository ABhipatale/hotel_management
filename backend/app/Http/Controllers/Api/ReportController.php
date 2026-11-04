<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Bill;
use App\Models\Branch;
use App\Models\Expense;
use App\Models\HotelTable;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
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
        $today = now()->startOfDay();
        $month = now()->startOfMonth();

        $paid = fn () => Bill::where('status', 'paid')->when($branch, fn ($q) => $q->where('branch_id', $branch));
        $tables = HotelTable::when($branch, fn ($q) => $q->where('branch_id', $branch));
        $expenses = fn ($from) => Expense::where('expense_date', '>=', $from->toDateString())->when($branch, fn ($q) => $q->where('branch_id', $branch))->sum('amount');
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
            'sales_last_7_days' => $this->salesSeries($branch, now()->subDays(6)->startOfDay(), now(), 'day'),
        ];
    }

    public function report(Request $r, string $type)
    {
        $branch = $this->branchFilter($r);
        $from = Carbon::parse($r->query('from', now()->startOfMonth()->toDateString()))->startOfDay();
        $to = Carbon::parse($r->query('to', now()->toDateString()))->endOfDay();

        return match ($type) {
            'sales' => ['group' => $g = $r->query('group', 'day'), 'rows' => $this->salesSeries($branch, $from, $to, in_array($g, ['day', 'month', 'year'], true) ? $g : 'day')],
            'tables' => $this->tables($branch, $from, $to),
            'waiters' => $this->waiters($branch, $from, $to)->values(),
            'items' => $this->items($branch, $from, $to)->values(),
            'payments' => $this->payments($branch, $from, $to),
            'expenses' => Expense::whereBetween('expense_date', [$from->toDateString(), $to->toDateString()])->when($branch, fn ($q) => $q->where('branch_id', $branch))
                ->select('category', DB::raw('SUM(amount) as total'), DB::raw('COUNT(*) as entries'))->groupBy('category')->orderByDesc('total')->get(),
            'inventory' => InventoryItem::when($branch, fn ($q) => $q->where('branch_id', $branch))->orderBy('name')->get()->map(fn ($i) => $i->toArray() + ['low_stock' => $i->quantity <= $i->min_quantity]),
            'pnl' => $this->pnl($branch, $from, $to),
            'branches' => $this->branchComparison($from, $to),
            default => abort(404),
        };
    }

    /** Owners/unlocked managers may pass branch_id=all for consolidated figures. */
    private function branchFilter(Request $r): ?int
    {
        $u = $r->user();
        $unlocked = ! $u->branch_id || $u->role === 'owner';
        $req = $r->query('branch_id', $r->header('X-Branch-Id'));
        if ($unlocked && ($req === 'all' || ($req === null && $u->role === 'owner'))) {
            return null;
        }

        return $this->branch($r);
    }

    private function salesSeries(?int $branch, Carbon $from, Carbon $to, string $group): array
    {
        $rows = Bill::where('status', 'paid')->whereBetween('created_at', [$from, $to])->when($branch, fn ($q) => $q->where('branch_id', $branch))
            ->select(DB::raw('DATE(created_at) as d'), DB::raw('SUM(grand_total) as sales'), DB::raw('SUM(tax) as tax'), DB::raw('SUM(discount) as discount'), DB::raw('COUNT(*) as bills'))
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
        $exp = (float) Expense::whereBetween('expense_date', [$from->toDateString(), $to->toDateString()])->when($branch, fn ($q) => $q->where('branch_id', $branch))->sum('amount');

        return ['sales' => $sales, 'tax_collected' => $tax, 'net_sales' => round($sales - $tax, 2), 'expenses' => $exp, 'profit' => round($sales - $tax - $exp, 2)];
    }

    private function branchComparison(Carbon $from, Carbon $to)
    {
        return Branch::all()->map(function ($b) use ($from, $to) {
            return ['branch_id' => $b->id, 'branch' => $b->name] + $this->pnl($b->id, $from, $to);
        });
    }
}
