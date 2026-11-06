import { useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { purchase } from '../../lib/payment'
import { useT } from '../../i18n'
import PlanCards from '../../components/PlanCards'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { dateOnly, money } from '../../lib/format'
import { Badge, Card, PageHeader, SectionTitle, Spinner, statusTone, Table } from '../../components/ui'

/** One subscription, paid monthly or yearly. */
export default function Subscription() {
  const { refresh } = useAuth()
  const t = useT()
  const toast = useToast()
  const ask = useConfirm()
  const { data: cur, loading, reload } = useApi('/subscription')
  const { data: price } = useApi('/subscription/pricing')
  const { data: pays, reload: reloadPays } = useApi('/subscription/payments')
  const [busy, setBusy] = useState(null)

  const buy = async (cycle) => {
    const amount = cycle === 'yearly' ? price.price_yearly : price.price_monthly
    const yearly = cycle === 'yearly'
    const expiredNow = cur?.expired
    if (!(await ask({
      title: expiredNow ? (yearly ? t('Renew yearly?') : t('Renew monthly?')) : (yearly ? t('Extend yearly?') : t('Extend monthly?')),
      message: expiredNow
        ? (yearly ? t('{amount} for 1 year. Access is restored immediately.', { amount: money(amount) }) : t('{amount} for 1 month. Access is restored immediately.', { amount: money(amount) }))
        : (yearly ? t('{amount} for 1 year. It is added after your current end date.', { amount: money(amount) }) : t('{amount} for 1 month. It is added after your current end date.', { amount: money(amount) })),
      confirmText: t('Pay {amount}', { amount: money(amount) }),
      tone: 'primary',
    }))) return
    setBusy(cycle)
    try {
      const sub = await purchase(cycle)
      if (sub) { toast.success(t('Payment successful. Subscription updated')); await refresh(); reload(); reloadPays() }
    } catch (e) { toast.error(e) } finally { setBusy(null) }
  }

  if (loading || !price) return <Spinner />
  const sub = cur.subscription
  const expired = cur.expired
  const daysLeft = sub ? Math.ceil((new Date(sub.ends_at) - Date.now()) / 86400000) : 0

  return (
    <div className="space-y-6">
      <PageHeader title="Subscription" sub="Pay monthly or yearly — everything is included" />

      {/* Current status */}
      <Card className={`flex flex-wrap items-center justify-between gap-4 ${expired ? '!bg-rose-50' : ''}`}>
        <div className="flex items-center gap-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${expired ? 'bg-rose-100 text-rose-700' : 'bg-brand-soft text-brand'}`}><CalendarCheck className="h-6 w-6" /></span>
          <div>
            <div className="flex items-center gap-2 text-lg font-extrabold">{expired ? t('Subscription expired') : t('Subscription active')} <Badge tone={expired ? 'red' : statusTone(sub?.status)}>{expired ? 'expired' : 'active'}</Badge></div>
            <div className="text-sm text-muted">
              {sub ? <><span className="capitalize">{t(sub.billing_cycle)}</span> · {expired ? t('ended on') : t('renews / ends on')} <b className="text-ink">{dateOnly(sub.ends_at)}</b></> : t('No subscription yet')}
            </div>
          </div>
        </div>
        {sub && !expired && <span className={`rounded-full px-3.5 py-1.5 text-sm font-extrabold ${daysLeft <= 7 ? 'bg-accent text-white' : 'bg-brand-soft text-brand'}`}>{daysLeft === 1 ? t('1 day left') : t('{n} days left', { n: Math.max(daysLeft, 0) })}</span>}
      </Card>

      {/* Prices */}
      <section>
        <SectionTitle title={expired ? 'Renew your subscription' : 'Extend your subscription'} />
        <PlanCards price={price} onBuy={buy} busy={busy} verb={expired ? 'Renew' : 'Add'} />
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
