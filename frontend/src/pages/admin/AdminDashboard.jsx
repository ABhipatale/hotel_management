import { Building2, CalendarClock, IndianRupee, Repeat, ShoppingBag, Store, TrendingUp, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../../lib/useApi'
import { money, num } from '../../lib/format'
import { Card, ErrorNote, PageHeader, Spinner, Stat } from '../../components/ui'

export default function AdminDashboard() {
  const { data: d, loading, error } = useApi('/admin/dashboard')
  if (loading) return <Spinner />
  if (error) return <ErrorNote>{error}</ErrorNote>

  const rev = Object.entries(d.revenue_by_month || {}).map(([m, v]) => ({ m, v }))

  return (
    <>
      <PageHeader title="Platform overview" sub="All registered companies at a glance" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Registered companies" value={num(d.companies_total)} icon={Building2} />
        <Stat label="Active" value={num(d.companies_active)} icon={Store} tone="green" />
        <Stat label="On trial" value={num(d.companies_trial)} icon={CalendarClock} tone="sky" />
        <Stat label="Inactive / suspended" value={num(d.companies_inactive)} icon={Building2} tone="rose" />
        <Stat label="Paid subscribers" value={num(d.subscribers)} icon={Repeat} tone="green" />
        <Stat label="Total revenue" value={money(d.revenue_total)} icon={IndianRupee} tone="amber" />
        <Stat label="MRR" value={money(d.mrr)} icon={TrendingUp} />
        <Stat label="Expiring in 7 days" value={num(d.expiring_soon)} icon={CalendarClock} tone="rose" />
        <Stat label="Total users" value={num(d.users_total)} icon={Users} tone="sky" />
        <Stat label="Orders (platform)" value={num(d.orders_total)} icon={ShoppingBag} tone="amber" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-semibold">Revenue by month</h3>
          {rev.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={rev}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="v" fill="var(--brand)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-10 text-center text-sm text-muted">No payments yet</p>}
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold">Subscribers by plan</h3>
          {d.plan_breakdown.length ? d.plan_breakdown.map((p) => (
            <div key={p.name} className="flex items-center justify-between border-b border-line py-2.5 text-sm last:border-0"><span>{p.name}</span><b>{p.total}</b></div>
          )) : <p className="py-10 text-center text-sm text-muted">No active subscriptions</p>}
        </Card>
      </div>
    </>
  )
}
