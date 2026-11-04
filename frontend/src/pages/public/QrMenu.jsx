import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, ChefHat, Clock, Minus, Plus, Search, ShoppingCart, UtensilsCrossed } from 'lucide-react'
import { api, errMsg } from '../../lib/api'
import { applyBrand } from '../../lib/branding'
import { money } from '../../lib/format'
import { Button, Chips, Input, Modal, Spinner } from '../../components/ui'

const STEPS = [['pending', 'Received'], ['accepted', 'Accepted'], ['preparing', 'Cooking'], ['ready', 'Ready'], ['served', 'Served']]

/** Public, unauthenticated customer menu. Tenant comes from the URL slug + secret table token (validated server-side). */
export default function QrMenu() {
  const { slug, token } = useParams()
  const base = `/public/menu/${slug}/table/${token}`
  const [menu, setMenu] = useState(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [cart, setCart] = useState({})
  const [pick, setPick] = useState(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [cust, setCust] = useState({ customer_name: '', customer_phone: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [orders, setOrders] = useState([])
  const [trackOpen, setTrackOpen] = useState(false)

  useEffect(() => {
    api.get(base).then((r) => {
      setMenu(r.data)
      applyBrand(r.data.company, ' · Menu')
    }).catch((e) => setError(e.response?.status === 404 ? 'This QR code is not valid or the restaurant is currently unavailable.' : errMsg(e)))
  }, [base])

  const loadOrders = useCallback(() => api.get(`${base}/orders`).then((r) => setOrders(r.data)).catch(() => {}), [base])
  useEffect(() => {
    if (!menu) return
    loadOrders()
    const t = setInterval(loadOrders, 6000)
    return () => clearInterval(t)
  }, [menu, loadOrders])

  const list = useMemo(() => (menu?.items || []).filter((i) => (cat === 'all' || i.category_id === +cat) && i.name.toLowerCase().includes(q.toLowerCase())), [menu, cat, q])
  const lines = Object.values(cart)
  const count = lines.reduce((a, l) => a + l.quantity, 0)
  const total = lines.reduce((a, l) => a + l.price * l.quantity * (1 - l.discount / 100) * (1 + l.gst / 100), 0)
  const unit = (i, v) => +(v?.price ?? i.price) * (1 - i.discount_percent / 100)

  const add = (i, v) => {
    const key = `${i.id}:${v?.id || 0}`
    setCart((c) => ({ ...c, [key]: { key, food_item_id: i.id, variant_id: v?.id, name: i.name + (v ? ` (${v.name})` : ''), price: +(v?.price ?? i.price), discount: +i.discount_percent, gst: +i.gst_percent, quantity: (c[key]?.quantity || 0) + 1 } }))
  }
  const change = (key, d) => setCart((c) => {
    const n = { ...c }
    const qy = n[key].quantity + d
    if (qy <= 0) delete n[key]
    else n[key] = { ...n[key], quantity: qy }
    return n
  })

  const place = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`${base}/orders`, { ...cust, items: lines.map((l) => ({ food_item_id: l.food_item_id, variant_id: l.variant_id || null, quantity: l.quantity })) })
      setCart({}); setCartOpen(false); setTrackOpen(true); loadOrders()
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  if (error && !menu) return <div className="grid min-h-full place-items-center p-6 text-center"><div><UtensilsCrossed className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="max-w-xs text-muted">{error}</p></div></div>
  if (!menu) return <Spinner />
  const { company } = menu

  return (
    <div className="mx-auto min-h-full max-w-xl pb-28">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          {company.logo_url ? <img src={company.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand font-bold text-white">{company.name[0]}</div>}
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{company.name}</div><div className="text-xs text-muted">Table {menu.table.number}</div></div>
          {orders.length > 0 && <button onClick={() => setTrackOpen(true)} className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand"><Clock className="h-3.5 w-3.5" />My orders</button>}
        </div>
        <div className="relative mt-3"><Search className="absolute left-3 top-3 h-4 w-4 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes" className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand" /></div>
        <div className="-mb-3 mt-3"><Chips value={cat} onChange={setCat} items={[['all', 'All'], ...menu.categories.map((c) => [String(c.id), c.name])]} /></div>
      </header>

      <div className="space-y-3 p-4">
        {list.map((i) => {
          const qty = lines.filter((l) => l.food_item_id === i.id).reduce((a, l) => a + l.quantity, 0)
          return (
            <div key={i.id} className="flex gap-3 rounded-2xl border border-line bg-white p-3 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><i className={`h-3 w-3 shrink-0 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} /><span className="font-medium">{i.name}</span></div>
                {i.offer_text && <div className="mt-0.5 text-xs font-medium text-emerald-600">{i.offer_text}</div>}
                {i.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{i.description}</p>}
                <div className="mt-2 flex items-center gap-2"><b>{money(unit(i))}</b>{+i.discount_percent > 0 && <s className="text-xs text-muted">{money(i.price)}</s>}{i.variants.length > 0 && <span className="text-[11px] text-muted">· {i.variants.length + 1} sizes</span>}</div>
              </div>
              <div className="flex shrink-0 flex-col items-center justify-between">
                {i.image_path ? <img src={`${location.origin}/storage/${i.image_path}`} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-brand-soft"><UtensilsCrossed className="h-7 w-7 text-brand/40" strokeWidth={1.6} /></div>}
                <button onClick={() => (i.variants.length ? setPick(i) : add(i))} className="-mt-3 min-h-11 rounded-2xl border border-brand bg-white px-6 text-sm font-extrabold text-brand shadow-card transition active:scale-95 active:bg-brand-soft">{qty ? `ADD · ${qty}` : 'ADD'}</button>
              </div>
            </div>
          )
        })}
        {!list.length && <p className="py-12 text-center text-sm text-muted">No dishes found</p>}
      </div>

      {count > 0 && (
        <button onClick={() => setCartOpen(true)} className="safe-bottom fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-lg items-center justify-between rounded-[1.25rem] bg-accent px-5 py-4 text-white shadow-float">
          <span className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />{count} item(s)</span><b>View cart · {money(total)}</b>
        </button>
      )}

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick?.name}>
        {pick && [{ id: null, name: 'Regular', price: pick.price }, ...pick.variants].map((v) => (
          <button key={v.id ?? 'base'} onClick={() => { add(pick, v.id ? v : null); setPick(null) }} className="mb-2 flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-sm"><span>{v.name}</span><b>{money(unit(pick, v))}</b></button>
        ))}
      </Modal>

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Your cart">
        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <div className="flex items-center gap-2"><button onClick={() => change(l.key, -1)} className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100"><Minus className="h-3.5 w-3.5" /></button><b className="w-5 text-center">{l.quantity}</b><button onClick={() => change(l.key, 1)} className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><Plus className="h-3.5 w-3.5" /></button></div>
              <span className="w-20 text-right">{money(l.price * l.quantity * (1 - l.discount / 100))}</span>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Input label="Your name (optional)" value={cust.customer_name} onChange={(e) => setCust({ ...cust, customer_name: e.target.value })} />
            <Input label="Mobile (optional)" inputMode="tel" value={cust.customer_phone} onChange={(e) => setCust({ ...cust, customer_phone: e.target.value })} />
          </div>
          <Input label="Cooking instructions" value={cust.notes} onChange={(e) => setCust({ ...cust, notes: e.target.value })} />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-between border-t border-line pt-3 text-sm"><span className="text-muted">Total incl. GST (final bill is calculated at billing)</span><b className="text-lg">{money(total)}</b></div>
          <Button variant="accent" size="lg" className="w-full" loading={busy} onClick={place}>Place order</Button>
        </div>
      </Modal>

      <Modal open={trackOpen} onClose={() => setTrackOpen(false)} title="Your orders">
        {!orders.length ? <p className="py-6 text-center text-sm text-muted">No active orders</p> : orders.map((o) => {
          const idx = Math.max(0, STEPS.findIndex(([s]) => s === o.status))
          return (
            <div key={o.id} className="mb-4 rounded-2xl border border-line p-3">
              <div className="mb-3 flex items-center justify-between"><b className="text-sm">{o.order_no}</b>{o.status === 'ready' || o.status === 'served' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <ChefHat className="h-5 w-5 text-brand" />}</div>
              <div className="mb-3 flex items-center">{STEPS.map(([s, l], i) => <div key={s} className="flex flex-1 flex-col items-center"><div className={`h-2 w-full ${i <= idx ? 'bg-brand' : 'bg-slate-200'} ${i === 0 ? 'rounded-l-full' : ''} ${i === STEPS.length - 1 ? 'rounded-r-full' : ''}`} /><span className={`mt-1 text-[10px] ${i === idx ? 'font-semibold text-brand' : 'text-muted'}`}>{l}</span></div>)}</div>
              <ul className="space-y-0.5 text-sm text-muted">{o.items.map((i) => <li key={i.id}>{i.quantity}× {i.name}{i.variant ? ` (${i.variant})` : ''}</li>)}</ul>
            </div>
          )
        })}
      </Modal>
    </div>
  )
}
