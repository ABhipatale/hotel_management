import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Minus, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Button, Chips, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

/** Waiter POS: pick table → add items → place order. Totals here are an estimate; the server prices the order. */
export default function NewOrder() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const { data: items, loading } = useApi('/menu/items')
  const { data: cats } = useApi('/menu/categories')
  const { data: tables } = useApi('/tables')
  const [tableId, setTableId] = useState(params.get('table') || '')
  const [type, setType] = useState('dine_in')
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [cart, setCart] = useState({})
  const [pick, setPick] = useState(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)

  const list = useMemo(
    () => (items || []).filter((i) => i.is_available && (cat === 'all' || i.category_id === +cat) && i.name.toLowerCase().includes(q.toLowerCase())),
    [items, cat, q],
  )
  const lines = Object.values(cart)
  const count = lines.reduce((a, l) => a + l.quantity, 0)
  const total = lines.reduce((a, l) => a + l.price * l.quantity * (1 - l.discount / 100) * (1 + l.gst / 100), 0)

  const add = (item, variant) => {
    const key = `${item.id}:${variant?.id || 0}`
    setCart((c) => ({
      ...c,
      [key]: { key, food_item_id: item.id, variant_id: variant?.id, name: item.name + (variant ? ` (${variant.name})` : ''), price: +(variant?.price ?? item.price), discount: +item.discount_percent, gst: +item.gst_percent, quantity: (c[key]?.quantity || 0) + 1 },
    }))
  }
  const dec = (key) => setCart((c) => {
    const n = { ...c }
    if (n[key].quantity <= 1) delete n[key]
    else n[key] = { ...n[key], quantity: n[key].quantity - 1 }
    return n
  })

  const tapItem = (i) => (i.variants?.length ? setPick(i) : add(i))

  const submit = async () => {
    if (type === 'dine_in' && !tableId) return toast.error('Select a table')
    setBusy(true)
    try {
      await api.post('/orders', {
        table_id: type === 'dine_in' ? tableId : null,
        type, notes: notes || null,
        items: lines.map((l) => ({ food_item_id: l.food_item_id, variant_id: l.variant_id || null, quantity: l.quantity })),
      })
      toast.success('Order placed')
      nav(can('billing.manage') ? '/app/orders' : '/app/tables')
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  if (loading) return <Spinner />

  const Cart = (
    <div className="flex h-full flex-col">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)}><option value="dine_in">Dine-in</option><option value="takeaway">Takeaway</option><option value="delivery">Delivery</option></Select>
        {type === 'dine_in' && (
          <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">Select table</option>
            {tables?.map((t) => <option key={t.id} value={t.id}>T{t.number} · {t.status}</option>)}
          </Select>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {!lines.length && <p className="py-10 text-center text-sm text-muted">Cart is empty</p>}
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-2 rounded-xl border border-line p-2.5">
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.name}</div><div className="text-xs text-muted">{money(l.price)} each</div></div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => dec(l.key)} className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100">{l.quantity === 1 ? <Trash2 className="h-3.5 w-3.5 text-rose-600" /> : <Minus className="h-3.5 w-3.5" />}</button>
              <span className="w-5 text-center text-sm font-semibold">{l.quantity}</span>
              <button onClick={() => setCart((c) => ({ ...c, [l.key]: { ...l, quantity: l.quantity + 1 } }))} className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-3 border-t border-line pt-3">
        <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-between text-sm"><span className="text-muted">Estimated total (incl. GST)</span><b className="text-lg">{money(total)}</b></div>
        <Button size="lg" className="w-full" disabled={!lines.length} loading={busy} onClick={submit}>Place order</Button>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader title="New order" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="relative mb-3"><Search className="absolute left-3.5 top-3.5 h-5 w-5 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes" className="min-h-12 w-full rounded-2xl border border-line bg-white py-3 pl-10 pr-3 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" /></div>
          <Chips value={cat} onChange={setCat} items={[['all', 'All'], ...(cats || []).map((c) => [String(c.id), c.name])]} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {list.map((i) => (
              <button key={i.id} onClick={() => tapItem(i)} className="overflow-hidden rounded-3xl border border-line/70 bg-white text-left shadow-card transition active:scale-[.96]">
                {i.image_url ? <img src={i.image_url} alt="" className="h-28 w-full object-cover" /> : <div className="grid h-28 place-items-center bg-brand-soft text-4xl">🍽️</div>}
                <div className="p-3">
                  <div className="flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} /><span className="truncate text-sm font-medium">{i.name}</span></div>
                  <div className="mt-1 text-sm font-semibold text-brand">{money(i.price)}{i.variants?.length ? <span className="ml-1 text-[11px] font-normal text-muted">+ variants</span> : null}</div>
                </div>
              </button>
            ))}
          </div>
          {!list.length && <p className="py-10 text-center text-sm text-muted">No dishes found</p>}
        </div>
        <div className="hidden lg:block"><div className="sticky top-20 h-[calc(100vh-8rem)] rounded-2xl border border-line bg-white p-4">{Cart}</div></div>
      </div>

      {count > 0 && (
        <button onClick={() => setCartOpen(true)} className="animate-pop fixed inset-x-4 bottom-24 z-30 flex items-center justify-between rounded-3xl bg-brand-gradient px-5 py-4 text-white shadow-float lg:hidden">
          <span className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />{count} item(s)</span><b>{money(total)}</b>
        </button>
      )}
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Your order"><div className="h-[70dvh]">{Cart}</div></Modal>

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick?.name}>
        <div className="space-y-2">
          {pick && [{ id: null, name: 'Regular', price: pick.price }, ...pick.variants].map((v) => (
            <button key={v.id ?? 'base'} onClick={() => { add(pick, v.id ? v : null); setPick(null) }} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-sm hover:border-brand"><span>{v.name}</span><b>{money(v.price)}</b></button>
          ))}
        </div>
      </Modal>
    </>
  )
}
