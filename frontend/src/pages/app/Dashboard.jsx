import { AlertTriangle, Armchair, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/useApi'
import { money, num } from '../../lib/format'
import { Card, ErrorNote, Spinner, Stat } from '../../components/ui'

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444']

export default function Dashboard() {
  const { company } = useAuth()
  const { data: d, loading, error } = useApi('/dashboard', { poll: 30000 })
  if (loading) return <Spinner />
  if (error) return <ErrorNote>{error}</ErrorNote>

  return (
    <>
      <div className="relative mb-5 overflow-hidden rounded-[2rem] bg-brand-gradient p-5 text-white shadow-float">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-12 right-10 h-32 w-32 rounded-full bg-white/10" />
        <div className="relative">
          <div className="text-sm font-medium text-white/80">Today's sales · {company?.name}</div>
          <div className="mt-1 text-4xl font-extrabold tracking-tight">{money(d.today_sales)}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[['Orders', num(d.total_orders)], ['Pending', num(d.pending_orders)], ['Busy tables', num(d.active_tables)]].map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-white/15 px-2 py-2.5 backdrop-blur"><div className="text-lg font-bold">{v}</div><div className="text-[11px] text-white/80">{l}</div></div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly sales" value={money(d.month_sales)} icon={TrendingUp} />
        <Stat label="Available tables" value={num(d.available_tables)} icon={Armchair} tone="green" />
        <Stat label="Expenses (month)" value={money(d.month_expenses)} icon={Wallet} tone="amber" />
        <Stat label="Profit (month)" value={money(d.month_profit)} icon={d.month_profit >= 0 ? TrendingUp : TrendingDown} tone={d.month_profit >= 0 ? 'green' : 'rose'} sub="Sales − expenses" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-semibold">Sales — last 7 days</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={d.sales_last_7_days}>
                <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" fontSize={11} tickFormatter={(v) => v.slice(5)} /><YAxis fontSize={11} />
                <Tooltip formatter={(v) => money(v)} />
                <Area dataKey="sales" stroke="var(--brand)" strokeWidth={2} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Payments (month)</h3>
          {d.payment_analytics.length ? (
            <>
              <div className="h-40">
                <ResponsiveContainer>
                  <PieChart><Pie data={d.payment_analytics} dataKey="total" nameKey="method" innerRadius={40} outerRadius={65}>{d.payment_analytics.map((_, i) => <Cell key={i} fill={COLORS[i % 4]} />)}</Pie><Tooltip formatter={(v) => money(v)} /></PieChart>
                </ResponsiveContainer>
              </div>
              {d.payment_analytics.map((p, i) => (
                <div key={p.method} className="flex items-center justify-between py-1 text-sm"><span className="flex items-center gap-2 capitalize"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % 4] }} />{p.method}</span><b>{money(p.total)}</b></div>
              ))}
            </>
          ) : <p className="py-10 text-center text-sm text-muted">No payments yet</p>}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Best-selling items</h3>
          {d.best_sellers.length ? d.best_sellers.map((i) => (
            <div key={i.name} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{i.name}</span><span className="text-muted">{num(i.qty)} sold</span></div>
          )) : <p className="py-8 text-center text-sm text-muted">No sales yet</p>}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Waiter performance</h3>
          {d.waiter_performance.length ? d.waiter_performance.map((w) => (
            <div key={w.waiter} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{w.waiter}<span className="ml-2 text-xs text-muted">{w.orders} orders</span></span><b>{money(w.sales)}</b></div>
          )) : <p className="py-8 text-center text-sm text-muted">No data yet</p>}
        </Card>

        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-500" /> Inventory alerts</h3>
          {d.inventory_alerts.length ? d.inventory_alerts.map((i) => (
            <div key={i.id} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{i.name}</span><span className="text-rose-600">{i.quantity} {i.unit} left</span></div>
          )) : <p className="py-8 text-center text-sm text-muted">All stocked up</p>}
        </Card>
      </div>
    </>
  )
}
