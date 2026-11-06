import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, QrCode, StickyNote } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { ago, money } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useT } from '../../i18n'
import { Badge, Button, Card, Chips, Empty, PageHeader, Spinner, statusTone } from '../../components/ui'

const TABS = [['open', 'Open'], ['all', 'All today']]
const lbl = (t, s) => t(String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))

export default function Orders() {
  const { can } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const t = useT()
  const [tab, setTab] = useState('open')
  const { data, loading, reload } = useApi('/orders', { params: tab === 'open' ? { open: 1 } : { date: new Date().toISOString().slice(0, 10) }, poll: 8000 })

  const setStatus = async (o, status) => {
    try { await api.patch(`/orders/${o.id}/status`, { status }); reload() } catch (e) { toast.error(e) }
  }
  const bill = async (o) => {
    try { await api.post(`/orders/${o.id}/bill`); toast.success(t('Bill generated — open Billing to collect payment')); reload() } catch (e) { toast.error(e) }
  }

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title={t('Orders')} actions={can('orders.create') && <Link to="/app/order/new"><Button variant="accent" size="sm"><Plus className="h-4 w-4" /> {t('New order')}</Button></Link>} />
      <Chips items={TABS.map(([k, l]) => [k, t(l)])} value={tab} onChange={setTab} />

      {!data?.length ? <Empty title={t('No orders')} hint={t('New orders from waiters and customer QR scans appear here.')} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((o) => (
            <Card key={o.id} className="flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 font-semibold">{o.table ? t('Table {n}', { n: o.table.number }) : lbl(t, o.type)} {o.source === 'qr' && <QrCode className="h-3.5 w-3.5 text-brand" />}</div>
                  <div className="text-xs text-muted">{o.order_no} · {t('{time} ago', { time: ago(o.created_at) })}{o.waiter ? ` · ${o.waiter.name}` : ''}</div>
                </div>
                <Badge tone={statusTone(o.status)}>{lbl(t, o.status)}</Badge>
              </div>
              <ul className="my-3 flex-1 space-y-1 text-sm">
                {o.items.filter((i) => i.status !== 'cancelled').map((i) => <li key={i.id} className="flex justify-between"><span>{i.quantity}× {i.name}{i.variant ? ` (${i.variant})` : ''}</span><b className="tabular text-slate-700">{money(i.price * i.quantity)}</b></li>)}
              </ul>
              {o.notes && <p className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"><StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />{o.notes}</p>}
              <div className="flex flex-wrap gap-2">
                {o.status === 'pending' && can('orders.create') && <Button size="sm" variant="soft" onClick={() => setStatus(o, 'accepted')}>{t('Accept')}</Button>}
                {['accepted', 'preparing', 'ready'].includes(o.status) && <Button size="sm" variant="soft" onClick={() => setStatus(o, 'served')}>{t('Mark served')}</Button>}
                {['served', 'ready', 'preparing', 'accepted'].includes(o.status) && !o.bill && <Button size="sm" onClick={() => bill(o)}>{t('Generate bill')}</Button>}
                {o.bill && (can('billing.manage') && o.bill.status !== 'paid'
                  ? <Link to={`/app/billing?pay=${o.bill.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent px-3.5 text-xs font-extrabold text-white shadow-card active:scale-95">{t('Collect {amount}', { amount: money(o.bill.grand_total) })}</Link>
                  : <Badge tone="blue">{t('Bill {no}', { no: o.bill.bill_no })} · {money(o.bill.grand_total)}</Badge>)}
                {['pending', 'accepted', 'preparing'].includes(o.status) && <Button size="sm" variant="ghost" onClick={async () => (await ask({ title: t('Cancel this order?'), message: t('The order will be cancelled and removed from the open list.'), confirmText: t('Cancel order'), cancelText: t('Keep order') })) && setStatus(o, 'cancelled')}>{t('Cancel')}</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
