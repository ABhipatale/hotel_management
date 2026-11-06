import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Download, Plus, QrCode, RefreshCw, Trash2, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useT } from '../../i18n'
import { Button, Chips, Empty, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

const STATUSES = ['available', 'occupied', 'reserved', 'preparing', 'ready', 'billing', 'paid']

// Pastel card per status (inspired by modern POS floor plans).
const LOOK = {
  // Only theme colours + neutrals: teal = free / ready, coral = busy / billing, stone = idle states
  available: { card: 'bg-emerald-50 border-emerald-200', pill: 'bg-emerald-600 text-white', text: 'text-emerald-900', dot: 'bg-emerald-600' },
  occupied: { card: 'bg-amber-50 border-amber-200', pill: 'bg-amber-500 text-white', text: 'text-amber-900', dot: 'bg-amber-500' },
  reserved: { card: 'bg-slate-100 border-slate-300', pill: 'bg-slate-600 text-white', text: 'text-slate-800', dot: 'bg-slate-500' },
  preparing: { card: 'bg-sky-50 border-sky-200', pill: 'bg-sky-600 text-white', text: 'text-sky-900', dot: 'bg-sky-600' },
  ready: { card: 'bg-emerald-600 border-emerald-700', pill: 'bg-white text-emerald-700', text: 'text-white', dot: 'bg-emerald-600' },
  billing: { card: 'bg-orange-100 border-orange-300', pill: 'bg-orange-600 text-white', text: 'text-orange-900', dot: 'bg-orange-600' },
  paid: { card: 'bg-white border-slate-200', pill: 'bg-slate-500 text-white', text: 'text-slate-700', dot: 'bg-slate-400' },
}

function useTick(ms = 30000) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t) }, [ms])
}

const cap = (s) => s[0].toUpperCase() + s.slice(1)

const elapsed = (since) => {
  if (!since) return null
  const m = Math.max(0, Math.floor((Date.now() - new Date(since.replace(' ', 'T') + (since.includes('Z') || since.includes('+') ? '' : 'Z')).getTime()) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export default function Tables() {
  const { can, hasFeature, company } = useAuth()
  const tx = useT()
  const stLabel = (s) => tx(s === 'available' ? 'Free' : cap(s))
  const toast = useToast()
  const nav = useNavigate()
  const ask = useConfirm()
  const { data, loading, reload } = useApi('/tables', { poll: 10000 })
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [sel, setSel] = useState(null)
  const [qr, setQr] = useState(null)
  const manage = can('tables.manage')
  useTick()

  const counts = (data || []).reduce((a, t) => ({ ...a, [t.status]: (a[t.status] || 0) + 1 }), {})
  const rows = (data || []).filter((t) => filter === 'all' || t.status === filter)
  const busyCount = (data || []).filter((t) => t.status !== 'available').length

  const setStatus = async (t, status) => {
    try { await api.patch(`/tables/${t.id}/status`, { status }); toast.success(tx('Table {n} → {status}', { n: t.number, status: stLabel(status) })); setSel(null); reload() } catch (e) { toast.error(e) }
  }
  const remove = async (t) => {
    if (!(await ask({ title: tx('Delete table T{n}?', { n: t.number }), message: tx('The table and its QR code will be removed. Tables with open orders cannot be deleted.'), confirmText: tx('Delete table') }))) return
    try { await api.delete(`/tables/${t.id}`); setSel(null); reload() } catch (e) { toast.error(e) }
  }
  const showQr = async (t) => {
    try {
      const r = await api.get(`/tables/${t.id}/qr`, { responseType: 'text' })
      setQr({ table: t, svg: r.data, url: `${location.origin}/menu/${company.slug}/table/${t.qr_token?.token}` })
    } catch (e) { toast.error(e) }
  }
  const regen = async (t) => {
    if (!(await ask({ title: tx('Regenerate QR code?'), message: tx('The old printed QR will stop working. Print the new one and place it on the table.'), confirmText: tx('Regenerate'), tone: 'warning' }))) return
    try { await api.post(`/tables/${t.id}/qr/regenerate`); toast.success(tx('New QR generated')); setQr(null); reload() } catch (e) { toast.error(e) }
  }
  const downloadQr = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([qr.svg], { type: 'image/svg+xml' }))
    a.download = `${company.slug}-table-${qr.table.number}.svg`
    a.click()
  }

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title={tx('Tables')} sub={tx('{busy} busy · {free} free', { busy: busyCount, free: (data?.length || 0) - busyCount })} actions={manage && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {tx('Add')}</Button>} />

      <Chips value={filter} onChange={setFilter} items={[['all', tx('All ({n})', { n: data.length })], ...STATUSES.map((s) => [s, `${tx(cap(s))}${counts[s] ? ` (${counts[s]})` : ''}`])]} />

      {!rows.length ? <Empty icon={Users} title={tx('No tables here')} hint={manage ? tx('Add your first table to start taking orders.') : tx('Ask the owner to add tables.')} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {rows.map((t, i) => {
            const l = LOOK[t.status]
            return (
              <button key={t.id} onClick={() => setSel(t)} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} className={`animate-pop relative overflow-hidden rounded-[1.25rem] border-2 p-3.5 text-left shadow-sm transition active:scale-[.96] ${l.card} ${l.text}`}>
                <div className="flex min-h-6 items-center justify-between text-[11px] font-semibold opacity-70">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{tx('{n} seater', { n: t.capacity })}</span>
                  {t.open_orders > 0 && <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px]">{tx(t.open_orders > 1 ? '{n} orders' : '{n} order', { n: t.open_orders })}</span>}
                </div>
                <div className="my-3 text-4xl font-extrabold tracking-tight">T{t.number}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${l.pill}`}>{stLabel(t.status)}</span>
                  {t.open_since && <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold"><Clock className="h-3 w-3" />{elapsed(t.open_since)}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Modal open={!!sel} onClose={() => setSel(null)} title={tx('Table {n}', { n: sel?.number ?? '' })}>
        {sel && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-muted"><span className={`h-2.5 w-2.5 rounded-full ${LOOK[sel.status].dot}`} /><span className="capitalize">{tx('{status} · {n} seats', { status: stLabel(sel.status), n: sel.capacity })}</span></div>
            {can('orders.create') && <Button variant="accent" className="w-full" size="lg" onClick={() => nav(`/app/order/new?table=${sel.id}`)}>{sel.open_orders ? tx('Add items to order') : tx('Take order')}</Button>}
            {sel.open_orders > 0 && <Button className="w-full" variant="secondary" onClick={() => nav('/app/orders')}>{tx('View open orders')}</Button>}
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600">{tx('Change status')}</div>
              <div className="flex flex-wrap gap-2">{STATUSES.map((s) => <button key={s} onClick={() => setStatus(sel, s)} className={`rounded-full px-3.5 py-2 text-xs font-semibold capitalize ring-1 transition ${sel.status === s ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{stLabel(s) === 'Free' ? tx('Available') : stLabel(s)}</button>)}</div>
            </div>
            {manage && (
              <div className="flex gap-2">
                {hasFeature('qr') && company?.qr_enabled !== false && <Button variant="secondary" className="flex-1" onClick={() => { const t = sel; setSel(null); showQr(t) }}><QrCode className="h-4 w-4" /> {tx('QR code')}</Button>}
                <Button variant="ghost" onClick={() => remove(sel)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!qr} onClose={() => setQr(null)} title={tx('QR · Table {n}', { n: qr?.table.number ?? '' })}>
        {qr && (
          <div className="space-y-5 text-center">
            <div className="mx-auto w-full max-w-[16rem] rounded-[1.25rem] bg-brand-soft p-4 ring-1 ring-line">
              <div className="rounded-2xl bg-white p-3 shadow-card [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            </div>
            <div>
              <div className="text-sm font-semibold">{tx('Scan to order')}</div>
              <p className="mt-1 break-all rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-muted">{qr.url}</p>
            </div>
            <div className="flex gap-3"><Button variant="secondary" className="flex-1" onClick={downloadQr}><Download className="h-4 w-4" /> {tx('Download')}</Button><Button variant="secondary" className="flex-1" onClick={() => regen(qr.table)}><RefreshCw className="h-4 w-4" /> {tx('Regenerate')}</Button></div>
          </div>
        )}
      </Modal>

      <AddTable open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />
    </>
  )
}

function AddTable({ open, onClose, onDone }) {
  const tx = useT()
  const toast = useToast()
  const { data: staff } = useApi('/staff', { skip: !open })
  const [f, setF] = useState({ number: '', capacity: 4, waiter_id: '' })
  const submit = async (e) => {
    e.preventDefault()
    try { await api.post('/tables', { ...f, waiter_id: f.waiter_id || null }); toast.success(tx('Table added')); setF({ number: '', capacity: 4, waiter_id: '' }); onDone() } catch (x) { toast.error(x) }
  }
  return (
    <Modal open={open} onClose={onClose} title={tx('Add table')}>
      <form onSubmit={submit} className="space-y-3">
        <Input label={tx('Table number')} required inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
        <Input label={tx('Seats')} type="number" min="1" required value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        <Select label={tx('Assigned waiter')} value={f.waiter_id} onChange={(e) => setF({ ...f, waiter_id: e.target.value })}>
          <option value="">{tx('Unassigned')}</option>
          {staff?.filter((s) => s.role === 'waiter').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Button type="submit" size="lg" className="w-full">{tx('Add table')}</Button>
      </form>
    </Modal>
  )
}
