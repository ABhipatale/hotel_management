import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, QrCode } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { ago, money } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Button, Card, Chips, Empty, PageHeader, Spinner, statusTone } from '../../components/ui'

const TABS = [['open', 'Open'], ['all', 'All today']]

export default function Orders() {
  const { can } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const [tab, setTab] = useState('open')
  const { data, loading, reload } = useApi('/orders', { params: tab === 'open' ? { open: 1 } : { date: new Date().toISOString().slice(0, 10) }, poll: 8000 })

  const setStatus = async (o, status) => {
    try { await api.patch(`/orders/${o.id}/status`, { status }); reload() } catch (e) { toast.error(e) }
  }
  const bill = async (o) => {
    try { await api.post(`/orders/${o.id}/bill`); toast.success('Bill generated — open Billing to collect payment'); reload() } catch (e) { toast.error(e) }
  }

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Orders" actions={can('orders.create') && <Link to="/app/order/new"><Button size="sm"><Plus className="h-4 w-4" /> New order</Button></Link>} />
      <Chips items={TABS} value={tab} onChange={setTab} />

      {!data?.length ? <Empty title="No orders" hint="New orders from waiters and customer QR scans appear here." /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((o) => (
            <Card key={o.id} className="flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 font-semibold">{o.table ? `Table ${o.table.number}` : o.type.replace('_', ' ')} {o.source === 'qr' && <QrCode className="h-3.5 w-3.5 text-brand" />}</div>
                  <div className="text-xs text-muted">{o.order_no} · {ago(o.created_at)} ago{o.waiter ? ` · ${o.waiter.name}` : ''}</div>
                </div>
                <Badge tone={statusTone(o.status)}>{o.status}</Badge>
              </div>
              <ul className="my-3 flex-1 space-y-1 text-sm">
                {o.items.filter((i) => i.status !== 'cancelled').map((i) => <li key={i.id} className="flex justify-between"><span>{i.quantity}× {i.name}{i.variant ? ` (${i.variant})` : ''}</span><Badge tone={statusTone(i.status)}>{i.status}</Badge></li>)}
              </ul>
              {o.notes && <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">📝 {o.notes}</p>}
              <div className="flex flex-wrap gap-2">
                {o.status === 'pending' && can('orders.create') && <Button size="sm" variant="soft" onClick={() => setStatus(o, 'accepted')}>Accept</Button>}
                {['accepted', 'preparing', 'ready'].includes(o.status) && <Button size="sm" variant="soft" onClick={() => setStatus(o, 'served')}>Mark served</Button>}
                {['served', 'ready', 'preparing', 'accepted'].includes(o.status) && !o.bill && <Button size="sm" onClick={() => bill(o)}>Generate bill</Button>}
                {o.bill && <Badge tone="blue">Bill {o.bill.bill_no} · {money(o.bill.grand_total)}</Badge>}
                {['pending', 'accepted', 'preparing'].includes(o.status) && <Button size="sm" variant="ghost" onClick={async () => (await ask({ title: 'Cancel this order?', message: 'The order will be cancelled and removed from the open list.', confirmText: 'Cancel order', cancelText: 'Keep order' })) && setStatus(o, 'cancelled')}>Cancel</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
