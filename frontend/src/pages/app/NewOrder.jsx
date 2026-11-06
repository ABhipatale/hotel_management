import { useMemo, useState } from 'react'
import Img from '../../components/Img'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Minus, Plus, Search, ShoppingCart, Trash2, UtensilsCrossed } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useT } from '../../i18n'
import { Button, Chips, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

/** Waiter POS: pick table → add items → place order. Totals here are an estimate; the server prices the order. */
export default function NewOrder() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const t = useT()
  const { can, company } = useAuth()
  const gstOn = company?.gst_enabled !== false
  const { data: items, loading } = useApi('/menu/items')
  const { data: cats } = useApi('/menu/categories')
  const { data: tables } = useApi('/tables')
  // "Order for": a table, or no table at all (walk-in takeaway / delivery). A table is never required.
  const [target, setTarget] = useState(params.get('table') ? `t:${params.get('table')}` : 'takeaway')
  const tableId = target.startsWith('t:') ? target.slice(2) : ''
  const type = tableId ? 'dine_in' : target
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
  const total = lines.reduce((a, l) => a + l.price * l.quantity * (1 - l.discount / 100) * (1 + (gstOn ? l.gst : 0) / 100), 0)

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

  // withBill = counter sale: create the order and generate its bill in one step, then go straight to payment.
  const submit = async (withBill = false) => {
    setBusy(withBill ? 'bill' : 'order')
    try {
      const { data } = await api.post('/orders', {
        table_id: tableId || null,
        type, notes: notes || null,
        generate_bill: withBill || undefined,
        items: lines.map((l) => ({ food_item_id: l.food_item_id, variant_id: l.variant_id || null, quantity: l.quantity })),
      })
      if (withBill && data.bill) {
        toast.success(t('Bill {no} generated', { no: data.bill.bill_no }))
        nav(`/app/billing?pay=${data.bill.id}`)
      } else {
        toast.success(t('Order placed'))
        nav(can('billing.manage') ? '/app/orders' : '/app/tables')
      }
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  if (loading) return <Spinner />

  const Cart = (
    <div className="flex h-full flex-col">
      <div className="mb-3">
        <Select aria-label={t('Order for')} value={target} onChange={(e) => setTarget(e.target.value)}>
          <optgroup label={t('No table')}>
            <option value="takeaway">{t('Walk-in / Takeaway')}</option>
            <option value="delivery">{t('Delivery')}</option>
          </optgroup>
          {tables?.length > 0 && (
            <optgroup label={t('Dine-in tables')}>
              {tables.map((tb) => <option key={tb.id} value={`t:${tb.id}`}>{t('Table {n} · {status}', { n: tb.number, status: t(tb.status === 'available' ? 'Free' : tb.status[0].toUpperCase() + tb.status.slice(1)) })}</option>)}
            </optgroup>
          )}
        </Select>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {!lines.length && <p className="py-10 text-center text-sm text-muted">{t('Cart is empty')}</p>}
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-2 rounded-xl border border-line p-2.5">
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.name}</div><div className="text-xs text-muted">{t('{price} each', { price: money(l.price) })}</div></div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => dec(l.key)} className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100">{l.quantity === 1 ? <Trash2 className="h-3.5 w-3.5 text-rose-600" /> : <Minus className="h-3.5 w-3.5" />}</button>
              <span className="w-5 text-center text-sm font-semibold">{l.quantity}</span>
              <button onClick={() => setCart((c) => ({ ...c, [l.key]: { ...l, quantity: l.quantity + 1 } }))} className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-3 border-t border-line pt-3">
        <Input placeholder={t('Notes (optional)')} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-between text-sm"><span className="text-muted">{gstOn ? t('Estimated total (incl. GST)') : t('Estimated total')}</span><b className="text-lg">{money(total)}</b></div>
        <div className={`grid gap-2 ${can('billing.manage') ? 'grid-cols-2' : ''}`}>
          <Button variant="accent" size="lg" disabled={!lines.length || !!busy} loading={busy === 'order'} onClick={() => submit(false)}>{t('Place order')}</Button>
          {can('billing.manage') && <Button variant="secondary" size="lg" disabled={!lines.length || !!busy} loading={busy === 'bill'} onClick={() => submit(true)}>{t('Place & bill')}</Button>}
        </div>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader title={t('New order')} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="relative mb-3"><Search className="absolute left-3.5 top-3.5 h-5 w-5 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search dishes')} className="min-h-12 w-full rounded-2xl border border-line bg-white py-3 pl-10 pr-3 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" /></div>
          <Chips value={cat} onChange={setCat} items={[['all', t('All')], ...(cats || []).map((c) => [String(c.id), c.name])]} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {list.map((i) => (
              <button key={i.id} onClick={() => tapItem(i)} className="overflow-hidden rounded-[1.25rem] border border-line/70 bg-white text-left shadow-card transition active:scale-[.96]">
                {i.image_url ? <Img src={i.image_url} thumb className="h-28 w-full object-cover" /> : <div className="grid h-28 place-items-center bg-brand-soft"><UtensilsCrossed className="h-10 w-10 text-brand/40" strokeWidth={1.6} /></div>}
                <div className="p-3">
                  <div className="flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} /><span className="truncate text-sm font-medium">{i.name}</span></div>
                  <div className="mt-1 text-sm font-semibold text-brand">{money(i.price)}{i.variants?.length ? <span className="ml-1 text-[11px] font-normal text-muted">{t('+ variants')}</span> : null}</div>
                </div>
              </button>
            ))}
          </div>
          {!list.length && <p className="py-10 text-center text-sm text-muted">{t('No dishes found')}</p>}
        </div>
        <div className="hidden lg:block"><div className="sticky top-20 h-[calc(100vh-8rem)] rounded-2xl border border-line bg-white p-4">{Cart}</div></div>
      </div>

      {count > 0 && (
        <button onClick={() => setCartOpen(true)} className="animate-pop fixed inset-x-4 bottom-[7.25rem] z-30 flex items-center justify-between rounded-[1.25rem] bg-accent px-5 py-4 text-white shadow-float lg:hidden">
          <span className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />{t('{n} item(s)', { n: count })}</span><b>{money(total)}</b>
        </button>
      )}
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title={t('Your order')}><div className="h-[70dvh]">{Cart}</div></Modal>

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick?.name}>
        <div className="space-y-2">
          {pick && [{ id: null, name: t('Regular'), price: pick.price }, ...pick.variants].map((v) => (
            <button key={v.id ?? 'base'} onClick={() => { add(pick, v.id ? v : null); setPick(null) }} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-sm hover:border-brand"><span>{v.name}</span><b>{money(v.price)}</b></button>
          ))}
        </div>
      </Modal>
    </>
  )
}
