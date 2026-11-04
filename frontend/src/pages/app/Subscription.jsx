import { useState } from 'react'
import { Check } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { dateOnly, money } from '../../lib/format'
import { Badge, Button, Card, PageHeader, Spinner, statusTone, Table } from '../../components/ui'

const FEATURE_LABEL = { qr: 'QR ordering', thermal: 'Thermal printing', reports: 'Sales reports', advanced_reports: 'Advanced reports', inventory: 'Inventory', expenses: 'Expenses', pnl: 'Profit & Loss', advanced_permissions: 'Advanced permissions' }

export default function Subscription() {
  const { refresh } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const { data: cur, loading, reload } = useApi('/subscription')
  const { data: plans } = useApi('/subscription/plans')
  const { data: pays, reload: reloadPays } = useApi('/subscription/payments')
  const [cycle, setCycle] = useState('monthly')
  const [busy, setBusy] = useState(null)

  const choose = async (p) => {
    if (!(await ask({ title: `Switch to ${p.name}?`, message: `You will be billed ${cycle}. Your plan changes immediately.`, confirmText: 'Switch plan', tone: 'primary' }))) return
    setBusy(p.id)
    try { await api.post('/subscription', { plan_id: p.id, billing_cycle: cycle }); toast.success('Subscription updated'); await refresh(); reload(); reloadPays() } catch (e) { toast.error(e) } finally { setBusy(null) }
  }

  if (loading) return <Spinner />
  const sub = cur.subscription
  const lim = (v, used) => `${used} / ${v ?? '∞'}`

  return (
    <>
      <PageHeader title="Subscription" sub="Plan, usage and billing history" />
      <Card className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-muted">Current plan</div>
          <div className="text-xl font-semibold">{cur.plan?.name || 'None'} <Badge tone={cur.expired ? 'red' : statusTone(sub?.status)}>{cur.expired ? 'expired' : sub?.status}</Badge></div>
          <div className="text-sm text-muted">{cur.expired ? 'Expired on' : 'Renews / ends on'} {dateOnly(sub?.ends_at)}</div>
        </div>
        <div className="flex gap-6 text-sm">
          <div><div className="text-xs text-muted">Staff</div><b>{lim(cur.plan?.max_staff, cur.usage.staff)}</b></div>
          <div><div className="text-xs text-muted">Tables</div><b>{lim(cur.plan?.max_tables, cur.usage.tables)}</b></div>
        </div>
      </Card>

      <div className="mb-4 inline-flex rounded-full border border-line bg-white p-1">
        {['monthly', 'yearly'].map((c) => <button key={c} onClick={() => setCycle(c)} className={`rounded-full px-4 py-1.5 text-sm capitalize ${cycle === c ? 'bg-brand text-white' : 'text-muted'}`}>{c}</button>)}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {plans?.map((p) => {
          const isCur = cur.plan?.id === p.id && !cur.expired
          return (
            <Card key={p.id} className={isCur ? 'ring-2 ring-brand' : ''}>
              <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{p.name}</h3>{isCur && <Badge tone="violet">current</Badge>}</div>
              <div className="mt-1 text-2xl font-semibold">{money(cycle === 'yearly' ? p.price_yearly : p.price_monthly)}<span className="text-sm font-normal text-muted"> /{cycle === 'yearly' ? 'year' : 'month'}</span></div>
              <ul className="my-4 space-y-1.5 text-sm">
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" />{p.max_staff ?? 'Unlimited'} staff</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" />{p.max_tables ?? 'Unlimited'} tables</li>
                {(p.features || []).map((f) => <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-emerald-500" />{FEATURE_LABEL[f] || f}</li>)}
              </ul>
              <Button className="w-full" variant={isCur ? 'secondary' : 'primary'} loading={busy === p.id} onClick={() => choose(p)}>{isCur ? 'Renew' : cur.plan && p.price_monthly < cur.plan.price_monthly ? 'Downgrade' : 'Choose plan'}</Button>
            </Card>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Payments are processed by the platform’s payment gateway. In development, a simulated gateway activates plans instantly.</p>

      <h3 className="mb-3 mt-8 font-semibold">Payment history</h3>
      <Table rows={pays} empty="No payments yet" columns={[
        { header: 'Invoice', key: 'invoice_no' },
        { header: 'Date', render: (p) => dateOnly(p.paid_at || p.created_at) },
        { header: 'Amount', render: (p) => money(p.amount) },
        { header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
      ]} />
    </>
  )
}
