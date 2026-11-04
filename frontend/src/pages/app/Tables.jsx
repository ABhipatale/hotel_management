import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Download, Plus, QrCode, RefreshCw, Trash2, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Button, Chips, Empty, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

const STATUSES = ['available', 'occupied', 'reserved', 'preparing', 'ready', 'billing', 'paid']

// Pastel card per status (inspired by modern POS floor plans).
const LOOK = {
  available: { card: 'bg-emerald-50 border-emerald-200', pill: 'bg-emerald-500 text-white', text: 'text-emerald-900', dot: 'bg-emerald-500' },
  occupied: { card: 'bg-rose-50 border-rose-200', pill: 'bg-rose-500 text-white', text: 'text-rose-900', dot: 'bg-rose-500' },
  reserved: { card: 'bg-violet-100 border-violet-300', pill: 'bg-violet-600 text-white', text: 'text-violet-900', dot: 'bg-violet-500' },
  preparing: { card: 'bg-amber-50 border-amber-300', pill: 'bg-amber-500 text-white', text: 'text-amber-900', dot: 'bg-amber-500' },
  ready: { card: 'bg-teal-50 border-teal-200', pill: 'bg-teal-500 text-white', text: 'text-teal-900', dot: 'bg-teal-500' },
  billing: { card: 'bg-orange-50 border-orange-300', pill: 'bg-orange-500 text-white', text: 'text-orange-900', dot: 'bg-orange-500' },
  paid: { card: 'bg-slate-50 border-slate-200', pill: 'bg-slate-500 text-white', text: 'text-slate-700', dot: 'bg-slate-400' },
}

function useTick(ms = 30000) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t) }, [ms])
}

const elapsed = (since) => {
  if (!since) return null
  const m = Math.max(0, Math.floor((Date.now() - new Date(since.replace(' ', 'T') + (since.includes('Z') || since.includes('+') ? '' : 'Z')).getTime()) / 60000))
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export default function Tables() {
  const { can, hasFeature, company } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
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
    try { await api.patch(`/tables/${t.id}/status`, { status }); toast.success(`Table ${t.number} → ${status}`); setSel(null); reload() } catch (e) { toast.error(e) }
  }
  const remove = async (t) => {
    if (!confirm(`Delete table ${t.number}?`)) return
    try { await api.delete(`/tables/${t.id}`); setSel(null); reload() } catch (e) { toast.error(e) }
  }
  const showQr = async (t) => {
    try {
      const r = await api.get(`/tables/${t.id}/qr`, { responseType: 'text' })
      setQr({ table: t, svg: r.data, url: `${location.origin}/menu/${company.slug}/table/${t.qr_token?.token}` })
    } catch (e) { toast.error(e) }
  }
  const regen = async (t) => {
    if (!confirm('Regenerate QR? The old printed QR will stop working.')) return
    try { await api.post(`/tables/${t.id}/qr/regenerate`); toast.success('New QR generated'); setQr(null); reload() } catch (e) { toast.error(e) }
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
      <PageHeader title="Tables" sub={`${busyCount} busy · ${(data?.length || 0) - busyCount} free`} actions={manage && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add</Button>} />

      <Chips value={filter} onChange={setFilter} items={[['all', `All (${data.length})`], ...STATUSES.map((s) => [s, `${s[0].toUpperCase() + s.slice(1)}${counts[s] ? ` (${counts[s]})` : ''}`])]} />

      {!rows.length ? <Empty icon={Users} title="No tables here" hint={manage ? 'Add your first table to start taking orders.' : 'Ask the owner to add tables.'} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {rows.map((t, i) => {
            const l = LOOK[t.status]
            return (
              <button key={t.id} onClick={() => setSel(t)} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} className={`animate-pop relative overflow-hidden rounded-3xl border-2 p-3.5 text-left shadow-sm transition active:scale-[.96] ${l.card} ${l.text}`}>
                <div className="flex items-center justify-between text-[11px] font-semibold opacity-70">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{t.capacity} seater</span>
                  {t.open_orders > 0 && <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px]">{t.open_orders} order{t.open_orders > 1 ? 's' : ''}</span>}
                </div>
                <div className="my-3 text-4xl font-extrabold tracking-tight">T{t.number}</div>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${l.pill}`}>{t.status === 'available' ? 'Free' : t.status}</span>
                  {t.open_since && <span className="flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold"><Clock className="h-3 w-3" />{elapsed(t.open_since)}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Modal open={!!sel} onClose={() => setSel(null)} title={`Table ${sel?.number}`}>
        {sel && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-muted"><span className={`h-2.5 w-2.5 rounded-full ${LOOK[sel.status].dot}`} /><span className="capitalize">{sel.status}</span> · {sel.capacity} seats</div>
            {can('orders.create') && <Button className="w-full" size="lg" onClick={() => nav(`/app/order/new?table=${sel.id}`)}>{sel.open_orders ? 'Add items to order' : 'Take order'}</Button>}
            {sel.open_orders > 0 && <Button className="w-full" variant="secondary" onClick={() => nav('/app/orders')}>View open orders</Button>}
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600">Change status</div>
              <div className="flex flex-wrap gap-2">{STATUSES.map((s) => <button key={s} onClick={() => setStatus(sel, s)} className={`rounded-full px-3.5 py-2 text-xs font-semibold capitalize ring-1 transition ${sel.status === s ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{s}</button>)}</div>
            </div>
            {manage && (
              <div className="flex gap-2">
                {hasFeature('qr') && <Button variant="secondary" className="flex-1" onClick={() => { const t = sel; setSel(null); showQr(t) }}><QrCode className="h-4 w-4" /> QR code</Button>}
                <Button variant="ghost" onClick={() => remove(sel)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!qr} onClose={() => setQr(null)} title={`QR · Table ${qr?.table.number}`}>
        {qr && (
          <div className="space-y-5 text-center">
            <div className="mx-auto w-full max-w-[16rem] rounded-3xl bg-gradient-to-br from-brand-soft to-white p-4 ring-1 ring-line">
              <div className="rounded-2xl bg-white p-3 shadow-card [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            </div>
            <div>
              <div className="text-sm font-semibold">Scan to order</div>
              <p className="mt-1 break-all rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-muted">{qr.url}</p>
            </div>
            <div className="flex gap-3"><Button variant="secondary" className="flex-1" onClick={downloadQr}><Download className="h-4 w-4" /> Download</Button><Button variant="secondary" className="flex-1" onClick={() => regen(qr.table)}><RefreshCw className="h-4 w-4" /> Regenerate</Button></div>
          </div>
        )}
      </Modal>

      <AddTable open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />
    </>
  )
}

function AddTable({ open, onClose, onDone }) {
  const toast = useToast()
  const { data: staff } = useApi('/staff', { skip: !open })
  const [f, setF] = useState({ number: '', capacity: 4, waiter_id: '' })
  const submit = async (e) => {
    e.preventDefault()
    try { await api.post('/tables', { ...f, waiter_id: f.waiter_id || null }); toast.success('Table added'); setF({ number: '', capacity: 4, waiter_id: '' }); onDone() } catch (x) { toast.error(x) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add table">
      <form onSubmit={submit} className="space-y-3">
        <Input label="Table number" required inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
        <Input label="Seats" type="number" min="1" required value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        <Select label="Assigned waiter" value={f.waiter_id} onChange={(e) => setF({ ...f, waiter_id: e.target.value })}>
          <option value="">Unassigned</option>
          {staff?.filter((s) => s.role === 'waiter').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Button type="submit" size="lg" className="w-full">Add table</Button>
      </form>
    </Modal>
  )
}
