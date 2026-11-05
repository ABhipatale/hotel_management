import { useState } from 'react'
import { CalendarCheck, Check, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { dateOnly, money } from '../../lib/format'
import { Badge, Button, Card, PageHeader, SectionTitle, Spinner, statusTone, Table } from '../../components/ui'

const INCLUDED = ['Unlimited staff & tables', 'QR menu ordering', 'Thermal bill printing', 'Reports & inventory', 'Expenses & profit tracking']

/** One subscription, paid monthly or yearly. */
export default function Subscription() {
  const { refresh } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const { data: cur, loading, reload } = useApi('/subscription')
  const { data: price } = useApi('/subscription/pricing')
  const { data: pays, reload: reloadPays } = useApi('/subscription/payments')
  const [busy, setBusy] = useState(null)

  const buy = async (cycle) => {
    const amount = cycle === 'yearly' ? price.price_yearly : price.price_monthly
    const verb = cur?.expired ? 'Renew' : 'Extend'
    if (!(await ask({
      title: `${verb} ${cycle}?`,
      message: `${money(amount)} for ${cycle === 'yearly' ? '1 year' : '1 month'}. ${cur?.expired ? 'Access is restored immediately.' : 'It is added after your current end date.'}`,
      confirmText: `Pay ${money(amount)}`,
      tone: 'primary',
    }))) return
    setBusy(cycle)
    try {
      await api.post('/subscription', { billing_cycle: cycle })
      toast.success('Subscription updated')
      await refresh(); reload(); reloadPays()
    } catch (e) { toast.error(e) } finally { setBusy(null) }
  }

  if (loading || !price) return <Spinner />
  const sub = cur.subscription
  const expired = cur.expired
  const daysLeft = sub ? Math.ceil((new Date(sub.ends_at) - Date.now()) / 86400000) : 0
  const saving = price.price_monthly * 12 - price.price_yearly

  return (
    <div className="space-y-6">
      <PageHeader title="Subscription" sub="Pay monthly or yearly — everything is included" />

      {/* Current status */}
      <Card className={`flex flex-wrap items-center justify-between gap-4 ${expired ? '!bg-rose-50' : ''}`}>
        <div className="flex items-center gap-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${expired ? 'bg-rose-100 text-rose-700' : 'bg-brand-soft text-brand'}`}><CalendarCheck className="h-6 w-6" /></span>
          <div>
            <div className="flex items-center gap-2 text-lg font-extrabold">{expired ? 'Subscription expired' : 'Subscription active'} <Badge tone={expired ? 'red' : statusTone(sub?.status)}>{expired ? 'expired' : 'active'}</Badge></div>
            <div className="text-sm text-muted">
              {sub ? <><span className="capitalize">{sub.billing_cycle}</span> · {expired ? 'ended' : 'renews / ends'} on <b className="text-ink">{dateOnly(sub.ends_at)}</b></> : 'No subscription yet'}
            </div>
          </div>
        </div>
        {sub && !expired && <span className={`rounded-full px-3.5 py-1.5 text-sm font-extrabold ${daysLeft <= 7 ? 'bg-accent text-white' : 'bg-brand-soft text-brand'}`}>{Math.max(daysLeft, 0)} day{daysLeft === 1 ? '' : 's'} left</span>}
      </Card>

      {/* Prices */}
      <section>
        <SectionTitle title={expired ? 'Renew your subscription' : 'Extend your subscription'} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="flex flex-col">
            <div className="text-sm font-bold text-muted">Monthly</div>
            <div className="tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight">{money(price.price_monthly)}</div>
            <div className="text-sm text-muted">per month</div>
            <Button className="mt-5 w-full" size="lg" loading={busy === 'monthly'} disabled={!!busy} onClick={() => buy('monthly')}>{expired ? 'Renew' : 'Add'} 1 month</Button>
          </Card>

          <Card className="relative flex flex-col !border-brand ring-2 ring-brand/20">
            {saving > 0 && <span className="absolute right-4 top-4 rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-white">Save {money(saving)}</span>}
            <div className="text-sm font-bold text-brand">Yearly · best value</div>
            <div className="tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight">{money(price.price_yearly)}</div>
            <div className="text-sm text-muted">per year · {money(price.price_yearly / 12)}/month</div>
            <Button variant="accent" className="mt-5 w-full" size="lg" loading={busy === 'yearly'} disabled={!!busy} onClick={() => buy('yearly')}>{expired ? 'Renew' : 'Add'} 1 year</Button>
          </Card>
        </div>

        <Card className="mt-4">
          <div className="mb-3 text-sm font-extrabold">Included in both</div>
          <ul className="grid gap-2 text-sm font-medium sm:grid-cols-2">
            {INCLUDED.map((t) => <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-brand" strokeWidth={3} />{t}</li>)}
          </ul>
        </Card>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-4 w-4" /> Payments are processed by the platform's payment gateway.</p>
      </section>

      <section>
        <SectionTitle title="Payment history" />
        <Table rows={pays} empty="No payments yet" columns={[
          { header: 'Invoice', key: 'invoice_no' },
          { header: 'Date', render: (p) => dateOnly(p.paid_at || p.created_at) },
          { header: 'Amount', render: (p) => <b className="tabular">{money(p.amount)}</b> },
          { header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
        ]} />
      </section>
    </div>
  )
}
