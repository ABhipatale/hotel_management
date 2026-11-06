import { Link } from 'react-router-dom'
import SetupChecklist from '../../components/SetupChecklist'
import {
  AlertTriangle, Armchair, ArrowUpRight, BarChart3, CheckCircle2, Clock, Moon, Plus, QrCode, Receipt, ShoppingBag, Sun, Sunrise, TrendingDown,
  TrendingUp, Trophy, Users, UtensilsCrossed, Wallet,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../context/AuthContext'
import { useApi } from '../../lib/useApi'
import { useI18n } from '../../i18n'
import { ago, money, num, today } from '../../lib/format'
import { Badge, Card, ErrorNote, SectionTitle, Spinner, Stat, statusTone } from '../../components/ui'

// Chart palette = the three theme colours + two neutral tints
const TEAL = '#17645F'
const CORAL = '#FF6845'
const COLORS = [TEAL, CORAL, '#7DB9B3', '#D3C9BB']
const TIP = { borderRadius: 14, border: '1px solid #E4DCD0', boxShadow: '0 12px 32px -12px rgb(29 26 23 / .25)', fontSize: 12, fontWeight: 600 }

const lbl = (t, s) => t(String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))
const LOCALE = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' }

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return { text: 'Good morning', Icon: Sunrise }
  if (h < 17) return { text: 'Good afternoon', Icon: Sun }
  return { text: 'Good evening', Icon: Moon }
}

const QUICK = [
  { to: '/app/order/new', label: 'New order', icon: Plus, perm: 'orders.create', hot: true },
  { to: '/app/tables', label: 'Tables', icon: Armchair, perm: 'tables.view' },
  { to: '/app/billing', label: 'Bills', icon: Receipt, perm: 'billing.manage' },
  { to: '/app/menu', label: 'Menu', icon: UtensilsCrossed, perm: 'menu.manage' },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' },
  { to: '/app/staff', label: 'Staff', icon: Users, perm: 'users.manage' },
]

const NoData = ({ icon: Icon, text }) => (
  <div className="grid place-items-center gap-2 py-8 text-center text-sm text-muted">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-canvas"><Icon className="h-5 w-5 text-slate-400" /></span>
    {text}
  </div>
)

export default function Dashboard() {
  const { company, user, can } = useAuth()
  const { t, lang } = useI18n()
  const { data: d, loading, error } = useApi('/dashboard', { poll: 30000 })
  const { data: recent } = useApi('/orders', { params: { date: today() }, poll: 30000, skip: !can('orders.view') })
  if (loading) return <Spinner />
  if (error) return <ErrorNote>{error}</ErrorNote>

  const { text, Icon: GreetIcon } = greeting()
  const quick = QUICK.filter((q) => can(q.perm))
  const dateText = new Date().toLocaleDateString(LOCALE[lang] || 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  // The API returns DECIMAL sums as strings; the chart needs real numbers.
  const payments = d.payment_analytics.map((p) => ({ ...p, total: Number(p.total) }))
  const occupied = Math.max(0, d.active_tables)

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-muted"><GreetIcon className="h-4 w-4 text-accent" /> {dateText}</div>
        <h1 className="mt-1 text-[28px] font-extrabold leading-tight tracking-tight text-brand sm:text-3xl">{t(text)}, {user?.name?.split(' ')[0]}</h1>
      </div>

      {/* Sales summary — Deep Teal with coral highlights */}
      <div className="relative overflow-hidden rounded-[1.25rem] bg-brand p-5 text-white shadow-float sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-14 right-16 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/75">{t("Today's sales")} <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />{t('Live')}</span></div>
            <span className="max-w-[10rem] truncate rounded-full bg-white/10 px-3 py-1 text-xs font-bold ring-1 ring-white/15">{company?.name}</span>
          </div>
          <div className="tabular mt-2 text-[40px] font-extrabold leading-none tracking-tight sm:text-5xl">{money(d.today_sales)}</div>
          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/70"><TrendingUp className="h-3.5 w-3.5" /> {t('This month')}</div>
              <div className="tabular mt-0.5 text-lg font-extrabold">{money(d.month_sales)}</div>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/70">{d.month_profit >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />} {t('Profit (month)')}</div>
              <div className={`tabular mt-0.5 text-lg font-extrabold ${d.month_profit < 0 ? 'text-accent-soft' : ''}`}>{money(d.month_profit)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Orders today')} value={num(d.total_orders)} icon={ShoppingBag} />
        <Stat label={t('Pending orders')} value={num(d.pending_orders)} icon={Clock} tone="amber" sub={d.pending_orders ? t('Need attention') : t('All clear')} />
        <Stat label={t('Occupied tables')} value={num(occupied)} icon={Armchair} tone="amber" />
        <Stat label={t('Available tables')} value={num(d.available_tables)} icon={CheckCircle2} tone="green" />
      </section>

      {can('users.manage') && <SetupChecklist />}

      {/* Quick actions */}
      {quick.length > 0 && (
        <section>
          <SectionTitle title={t('Quick actions')} />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {quick.map(({ to, label, icon: Icon, hot }, i) => (
              <Link key={to} to={to} style={{ animationDelay: `${i * 40}ms` }} className={`animate-pop group flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-[1.25rem] p-3 text-center shadow-card transition active:scale-95 hover:-translate-y-0.5 hover:shadow-lift ${hot ? 'bg-accent text-white' : 'border border-line/70 bg-white'}`}>
                <span className={`grid h-11 w-11 place-items-center rounded-2xl ${hot ? 'bg-white/20 text-white' : 'bg-brand-soft text-brand transition group-hover:bg-brand group-hover:text-white'}`}><Icon className="h-5 w-5" strokeWidth={2.3} /></span>
                <span className={`text-xs font-bold ${hot ? 'text-white' : 'text-slate-700'}`}>{t(label)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Revenue analytics */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title={t('Revenue · last 7 days')} action={<Badge tone="green" dot={false}>{t('Sales')}</Badge>} />
          <div className="-ml-2 h-60">
            <ResponsiveContainer>
              <AreaChart data={d.sales_last_7_days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={TEAL} stopOpacity={0.28} /><stop offset="100%" stopColor={TEAL} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#E4DCD0" />
                <XAxis dataKey="period" fontSize={11} tickLine={false} axisLine={false} stroke="#7C7468" tickFormatter={(v) => v.slice(5)} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#7C7468" width={44} />
                <Tooltip formatter={(v) => money(v)} contentStyle={TIP} />
                <Area dataKey="sales" stroke={TEAL} strokeWidth={2.5} fill="url(#g)" activeDot={{ r: 5, fill: CORAL, stroke: '#fff', strokeWidth: 2 }} dot={{ r: 3, fill: TEAL }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <SectionTitle title={t('Payments · this month')} />
          {payments.length ? (
            <>
              <div className="h-40">
                <ResponsiveContainer>
                  <PieChart><Pie data={payments} dataKey="total" nameKey="method" innerRadius={44} outerRadius={68} paddingAngle={3} stroke="none">{payments.map((_, i) => <Cell key={i} fill={COLORS[i % 4]} />)}</Pie><Tooltip formatter={(v) => money(v)} contentStyle={TIP} /></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-2">
                {payments.map((p, i) => (
                  <div key={p.method} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold capitalize"><i className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % 4] }} />{lbl(t, p.method)}</span><b className="tabular">{money(p.total)}</b></div>
                ))}
              </div>
            </>
          ) : <NoData icon={Wallet} text={t('No payments yet')} />}
        </Card>
      </section>

      {/* Recent orders */}
      {can('orders.view') && (
        <section>
          <SectionTitle title={t('Recent orders')} action={<Link to="/app/orders" className="flex min-h-11 items-center gap-1 text-sm font-bold text-brand">{t('View all')} <ArrowUpRight className="h-4 w-4" /></Link>} />
          {recent?.length ? (
            <div className="space-y-2.5">
              {recent.slice(0, 5).map((o) => (
                <Link key={o.id} to="/app/orders" className="flex items-center gap-3 rounded-[1.25rem] border border-line/70 bg-white p-3.5 shadow-card transition active:scale-[.985]">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${o.source === 'qr' ? 'bg-accent-soft text-accent-dark' : 'bg-brand-soft text-brand'}`}>{o.source === 'qr' ? <QrCode className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-extrabold">{o.table ? t('Table {n}', { n: o.table.number }) : lbl(t, o.type)}</div>
                    <div className="truncate text-xs text-muted">{t('{n} item(s)', { n: o.items.length })} · {t('{time} ago', { time: ago(o.created_at) })}</div>
                  </div>
                  <Badge tone={statusTone(o.status)}>{lbl(t, o.status)}</Badge>
                </Link>
              ))}
            </div>
          ) : <Card><NoData icon={ShoppingBag} text={t('No orders yet today')} /></Card>}
        </section>
      )}

      {/* Insights */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle title={t('Best sellers')} />
          {d.best_sellers.length ? d.best_sellers.map((i, idx) => (
            <div key={i.name} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${idx === 0 ? 'bg-accent-soft text-accent-dark' : 'bg-canvas text-slate-500'}`}>{idx === 0 ? <Trophy className="h-4 w-4" /> : idx + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{i.name}</span>
              <Badge tone="slate" dot={false}>{t('{n} sold', { n: num(i.qty) })}</Badge>
            </div>
          )) : <NoData icon={UtensilsCrossed} text={t('No sales yet')} />}
        </Card>

        <Card>
          <SectionTitle title={t('Waiter performance')} />
          {d.waiter_performance.length ? d.waiter_performance.map((w) => (
            <div key={w.waiter} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-extrabold uppercase text-brand">{w.waiter[0]}</span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{w.waiter}</div><div className="text-xs text-muted">{t('{n} orders', { n: w.orders })}</div></div>
              <b className="tabular text-sm">{money(w.sales)}</b>
            </div>
          )) : <NoData icon={Users} text={t('No data yet')} />}
        </Card>

        <Card>
          <SectionTitle title={t('Inventory alerts')} />
          {d.inventory_alerts.length ? d.inventory_alerts.map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-dark"><AlertTriangle className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{i.name}</span>
              <Badge tone="amber">{i.quantity} {i.unit}</Badge>
            </div>
          )) : <NoData icon={Receipt} text={t('All stocked up')} />}
        </Card>
      </section>
    </div>
  )
}
