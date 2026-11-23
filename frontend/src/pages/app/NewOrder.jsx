import { useEffect, useMemo, useRef, useState } from 'react'
import Img from '../../components/Img'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTopbarSlot } from '../../lib/topbarSearch'
import { Hash, ImageOff, Printer, LayoutGrid, List, Loader2, Minus, Plus, Search, ShoppingCart, Trash2, UtensilsCrossed } from 'lucide-react'
import { api, isNetworkError } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { tableText, money } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useI18n } from '../../i18n'
import { kotConnection, kotPrefs, printKot } from '../../lib/kotSlip'
import { newRef, outbox } from '../../lib/outbox'
import { buildLocalBill, offlineNumber } from '../../lib/localBill'
import Receipt from '../../components/Receipt'
import { baseVariantName, catName, dishNames, variantName } from '../../lib/dishName'
import { Button, Chips, Input, Modal, Select, Spinner } from '../../components/ui'

/** Waiter POS: pick table → add items → place order. Totals here are an estimate; the server prices the order. */
export default function NewOrder() {
  const [params] = useSearchParams()
  const slot = useTopbarSlot() // wide screens: the search box lives in the top bar
  const phoneSlot = useTopbarSlot('topbar-phone') // phones: the table chooser and the view buttons live in the top bar
  const nav = useNavigate()
  const toast = useToast()
  const { t, lang } = useI18n()
  const nm = (i) => dishNames(i, lang)
  const cn = (c) => catName(c, lang)
  const { can, company, user } = useAuth()
  const gstOn = company?.gst_enabled !== false
  const { data: items, loading } = useApi('/menu/items')
  const { data: cats } = useApi('/menu/categories')
  const { data: allTables } = useApi('/tables')
  const tables = (company?.parcel_enabled ? allTables : allTables?.filter((x) => x.kind !== 'parcel'))?.filter((x) => !x.is_split) // a shared table is ordered for through its parts (T1A / T1B);  parcel counters are an option the platform admin switches on
  // Edit mode (?edit=<order id>, from Orders): the order's dishes are loaded into the cart and saved back until the order is paid
  const editParam = params.get('edit')
  const { data: editData, loading: loadingEdit } = useApi(`/orders/${editParam}`, { skip: !editParam })
  // "Order for": a table, or no table at all (walk-in takeaway / delivery). A table is never required.
  const [target, setTarget] = useState(params.get('table') ? `t:${params.get('table')}` : 'takeaway')
  const tableId = target.startsWith('t:') ? target.slice(2) : ''
  const type = tableId ? 'dine_in' : target
  // A busy table opens its running order the same way: the dishes already on it are in the cart and can be changed,
  // and saving sends the kitchen only the difference. No answer (offline, no permission): new dishes are added to it as before.
  const { data: tableOrders, loading: loadingRun, error: runError } = useApi('/orders', { params: { table_id: tableId, open: 1 }, skip: !tableId || !!editParam })
  const openHere = editParam || !tableId ? [] : (tableOrders || []).filter((o) => String(o.table_id) === String(tableId) && !['paid', 'cancelled'].includes(o.status) && o.bill?.status !== 'paid')
  // the one the server adds to (not billed yet, oldest first); a customer's QR order waiting for approval only if nothing else
  const running = [...openHere].sort((a, b) => (!!a.bill - !!b.bill) || ((a.status === 'pending') - (b.status === 'pending')) || a.id - b.id)[0] || null
  const editing = editParam ? editData : running
  const editId = editParam || running?.id || null
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [cart, setCart] = useState({})
  const [pick, setPick] = useState(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [askKot, setAskKot] = useState(null) // { kots, to, title }: the "print the kitchen slip?" popup (new dishes, and a cancel slip for reduced ones)
  const [printing, setPrinting] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [offlineBill, setOfflineBill] = useState(null) // the provisional bill made on this device while offline
  const [base, setBase] = useState(null) // the order's dishes as loaded ({ key: line }): sent back so the server applies only this screen's changes
  const filledFor = useRef(null)
  useEffect(() => {
    if (!editing || !items || filledFor.current === editing.id) return
    filledFor.current = editing.id
    const next = {}
    editing.items.filter((oi) => oi.status !== 'cancelled').forEach((oi) => {
      const food = items.find((f) => f.id === oi.food_item_id)
      const variant = oi.variant ? food?.variants?.find((v) => v.name === oi.variant) : null
      const key = `${oi.food_item_id}:${variant?.id || 0}`
      next[key] = { key, food_item_id: oi.food_item_id, variant_id: variant?.id, code: food?.code, name: oi.name + (oi.variant ? ` (${oi.variant})` : ''), price: +oi.price, discount: +oi.discount_percent, gst: +oi.gst_percent, quantity: (next[key]?.quantity || 0) + oi.quantity }
    })
    // Orders → Edit: the cart is the order. A running table: dishes tapped while its order was still loading are kept as new ones.
    setCart((c) => {
      if (editParam) return next
      const merged = { ...next }
      Object.values(c).forEach((l) => { merged[l.key] = merged[l.key] ? { ...merged[l.key], quantity: merged[l.key].quantity + l.quantity } : l })
      return merged
    })
    setBase(next)
    // Orders → Edit shows the order's own note and table; a running table keeps the chosen table and an empty note (for the kitchen slip)
    setNotes((n) => (editParam ? editing.notes || '' : n))
    setTarget((tg) => (editParam ? (editing.table_id ? `t:${editing.table_id}` : editing.type) : tg))
  }, [editing, items, editParam])
  // Choosing another table / takeaway: the running order's dishes stay with their table, only the new ones come along
  const chooseTarget = (v) => {
    if (base && !editParam) {
      setCart((c) => {
        const left = {}
        Object.values(c).forEach((l) => { const q = l.quantity - (base[l.key]?.quantity || 0); if (q > 0) left[l.key] = { ...l, quantity: q } })
        return left
      })
      setBase(null)
      filledFor.current = null
    }
    setTarget(v)
  }

  const qs = q.trim().toLowerCase()
  const list = useMemo(
    () => (items || []).filter((i) => i.is_available && (cat === 'all' || i.category_id === +cat) && (!qs || i.name.toLowerCase().includes(qs) || (i.name_mr || '').toLowerCase().includes(qs) || String(i.code) === qs)),
    [items, cat, qs],
  )
  // Typing a product number (e.g. "3") finds that dish at once; Enter or the highlighted bar adds it
  const exact = /^\d+$/.test(qs) ? (items || []).find((i) => i.is_available && String(i.code) === qs) : null
  const lines = Object.values(cart)
  const count = lines.reduce((a, l) => a + l.quantity, 0)
  const total = lines.reduce((a, l) => a + l.price * l.quantity * (1 - l.discount / 100) * (1 + (gstOn ? l.gst : 0) / 100), 0)
  // a loaded order: did this screen change any dish? (a running table with nothing changed has nothing to send)
  const changed = !base || lines.some((l) => l.quantity !== base[l.key]?.quantity) || Object.keys(base).some((k) => !cart[k])
  const isRunning = !!running && !editParam // a busy table's order, opened from Tables (not from Orders → Edit)
  const waitRun = !!tableId && !editParam && loadingRun // looking up whether this table has a running order
  const canSaveBill = isRunning && !editing?.bill && can('billing.manage')

  const add = (item, variant) => {
    const key = `${item.id}:${variant?.id || 0}`
    setCart((c) => ({
      ...c,
      [key]: { key, food_item_id: item.id, code: item.code, variant_id: variant?.id, name: item.name + ((variant ? variant.name : item.variants?.length && item.base_variant_name) ? ` (${variant ? variant.name : item.base_variant_name})` : ''), price: +(variant?.price ?? item.price), discount: +item.discount_percent, gst: +item.gst_percent, quantity: (c[key]?.quantity || 0) + 1 },
    }))
  }
  const dec = (key) => setCart((c) => {
    const n = { ...c }
    if (n[key].quantity <= 1) delete n[key]
    else n[key] = { ...n[key], quantity: n[key].quantity - 1 }
    return n
  })

  // how many of a dish are in the cart (all variants)
  const qtyOf = (id) => lines.reduce((a, l) => a + (l.food_item_id === id ? l.quantity : 0), 0)
  const lastKeyOf = (id) => [...lines].reverse().find((l) => l.food_item_id === id)?.key
  const hasPhotos = (items || []).some((i) => i.image_url)
  // Each login chooses how dishes are shown (remembered on this device): picture cards or a compact list with a small picture
  const viewKey = `hms.dishview.${user?.id}`
  const [view, setViewState] = useState(() => { try { return localStorage.getItem(viewKey) } catch { return null } })
  const setView = (v) => { setViewState(v); try { localStorage.setItem(viewKey, v) } catch { /* private mode */ } }
  const mode = view || (hasPhotos ? 'grid' : 'list') // 'grid' | 'list' | 'numbers'
  const asGrid = mode === 'grid'
  // List view only: show or hide the small dish pictures (remembered per login)
  const imgKey = `hms.dishimg.${user?.id}`
  const [imgPref, setImgPrefState] = useState(() => { try { return localStorage.getItem(imgKey) } catch { return null } })
  const showImg = imgPref !== '0'
  const toggleImg = () => { const v = showImg ? '0' : '1'; setImgPrefState(v); try { localStorage.setItem(imgKey, v) } catch { /* private mode */ } }

  const tapItem = (i) => (i.variants?.length ? setPick(i) : add(i))
  const quickAdd = (i) => { tapItem(i); setQ(''); if (!i.variants?.length) toast.success(`#${i.code} ${i.name}`) }
  const onSearchKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); const hit = exact || (list.length === 1 ? list[0] : null); if (hit) quickAdd(hit) } }

  // Only the owner may take orders and print bills without internet. The order is kept on this device and sent when the connection is back.
  const canOffline = user?.role === 'owner'
  const goOffline = async (withBill, ref, payload) => {
    const orderNo = offlineNumber('O')
    const billNo = withBill ? offlineNumber('B') : null
    const sum = Math.round(total * 100) / 100
    // saved first, so the order can never be lost even if the bill below cannot be built
    outbox.add({ id: ref, userId: user.id, createdAt: new Date().toISOString(), payload, local: { order_no: orderNo, bill_no: billNo }, total: sum, summary: lines.map((l) => `${l.quantity}× ${l.name}`).join(', '), status: 'pending' })
    const label = billNo || orderNo
    setCart({}); setNotes('')
    if (!withBill) { toast.success(t('Saved on this device ({no}). It will be sent when the internet is back.', { no: label })); return }
    let comp = company
    let prn = null
    try { comp = (await api.get('/company')).data } catch { /* no saved copy: the shop details of this session are used */ }
    try { prn = (await api.get('/printer')).data } catch { /* no saved printer settings: browser print */ }
    setOfflineBill(buildLocalBill({ lines, items, company: comp, printer: prn, table: (tables || []).find((x) => String(x.id) === String(tableId)), user, orderNo, billNo }))
  }

  // Optional kitchen slips from this device's printer: automatic, asked with a popup, or not at all. true = the popup is open.
  const slips = (kots, to, title = 'Order placed') => {
    const list = (kots || []).filter(Boolean)
    const mode = kotPrefs.orderMode(company?.kot_print_mode)
    if (!list.length || !company?.kot_print) return false
    if (mode === 'auto' && kotConnection()) {
      list.reduce((p, k) => p.then(() => printKot(k, company, lang)).then(() => { api.post(`/kots/${k.id}/printed`).catch(() => {}) }), Promise.resolve())
        .catch((e) => toast.error(e.message ? t(e.message) : t('Printing failed')))
      return false
    }
    if (mode === 'ask') { setAskKot({ kots: list, to, title }); return true }
    return false
  }
  // one save = one reference, kept while the same save is retried: a second tap after a lost answer never adds dishes twice
  const saveRef = useRef(null)

  // withBill = counter sale: create the order and generate its bill in one step, then go straight to payment.
  const submit = async (withBill = false) => {
    setBusy(withBill ? 'bill' : 'order')
    try {
      if (editId) {
        const linesOf = (ls) => ls.map((l) => ({ food_item_id: l.food_item_id, variant_id: l.variant_id || null, quantity: l.quantity }))
        let data = null
        if (!isRunning || changed || notes.trim()) {
          const body = { items: linesOf(lines) }
          if (base) body.base = linesOf(Object.values(base)) // only this screen's changes are applied; a colleague's dishes added meanwhile stay
          if (isRunning) { if (notes.trim()) body.kot_note = notes.trim() } else body.notes = notes || null // a running table's note is for the kitchen slip of the new dishes
          const sig = JSON.stringify(body)
          if (saveRef.current?.sig !== sig) saveRef.current = { sig, ref: newRef() }
          data = (await api.put(`/orders/${editId}/items`, { ...body, client_ref: saveRef.current.ref })).data
          saveRef.current = null
          setBase({ ...cart }); if (isRunning) setNotes('') // saved: the cart is now the order (a retry of the bill step sends nothing again)
        }
        if (withBill) { // a running table, not billed yet: its bill now, then payment
          const { data: bill } = await api.post(`/orders/${editId}/bill`)
          toast.success(t('Bill {no} generated', { no: bill.bill_no }))
          nav(`/app/billing?pay=${bill.id}&from=new`)
          return
        }
        toast.success(data?.kot ? t('Sent to kitchen — KOT #{n}', { n: data.kot.number }) : t('Order updated'))
        const to = editing?.bill && can('billing.manage') ? `/app/billing?pay=${editing.bill.id}&from=${isRunning ? 'new' : 'orders'}` : isRunning ? (can('billing.manage') ? '/app/orders' : '/app/tables') : '/app/orders'
        if (slips(data?.kots, to, 'Order updated')) return
        nav(to)
        return
      }
      const payload = {
        table_id: tableId || null,
        type, notes: notes || null,
        generate_bill: withBill || undefined,
        items: lines.map((l) => ({ food_item_id: l.food_item_id, variant_id: l.variant_id || null, quantity: l.quantity })),
      }
      const ref = canOffline ? newRef() : null // the owner's orders carry a reference, so a retry after a lost answer is never a second order
      if (ref && !navigator.onLine) { await goOffline(withBill, ref, payload); return }
      let res
      try {
        res = await api.post('/orders', ref ? { ...payload, client_ref: ref } : payload, ref ? { timeout: 15000 } : undefined)
      } catch (e) {
        if (ref && isNetworkError(e)) { await goOffline(withBill, ref, payload); return } // no real internet / server unreachable
        throw e
      }
      const { data } = res
      if (withBill && data.bill) {
        toast.success(t('Bill {no} generated', { no: data.bill.bill_no }))
        nav(`/app/billing?pay=${data.bill.id}&from=new`)
      } else {
        toast.success(data.kot ? t('Sent to kitchen — KOT #{n}', { n: data.kot.number }) : data.merged ? t('Added to the existing order {no}', { no: data.order_no }) : t('Order placed'))
        const dest = can('billing.manage') ? '/app/orders' : '/app/tables'
        if (slips([data.kot], dest)) return
        nav(dest)
      }
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  const answerKot = async (yes) => {
    const a = askKot
    if (!yes) { setAskKot(null); nav(a.to); return }
    setPrinting(true)
    try {
      for (const k of a.kots) {
        await printKot(k, company, lang)
        api.post(`/kots/${k.id}/printed`).catch(() => {})
        setAskKot((s) => s && { ...s, kots: s.kots.filter((x) => x.id !== k.id) }) // printed: a retry prints only what is left
      }
      setAskKot(null); nav(a.to)
    } catch (e) { toast.error(e.message ? t(e.message) : t('Printing failed')) } finally { setPrinting(false) } // stays open so you can retry or tap Not now
  }

  if (loading || (editParam && loadingEdit)) return <Spinner />

  const Cart = (
    <div className="flex h-full flex-col">
      {editId && <div className="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-sm font-bold text-brand">{t('Editing {no}', { no: `${editing?.order_no || ''}${editing?.table ? ` · ${t('Table {n}', { n: editing.table.number })}` : ''}` })}</div>}
      {isRunning && openHere.length > 1 && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{t('This table has {n} open orders. The others are in Orders.', { n: openHere.length })}</p>}
      {waitRun && <p className="mb-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t('Loading')}</p>}
      {runError && !editParam && tableId && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{t("This table's order could not be loaded. New dishes will still be added to it.")}</p>}
      <div className={`mb-3 hidden ${editParam ? '' : 'lg:block'}`}>
        <Select aria-label={t('Order for')} disabled={!!editParam} value={target} onChange={(e) => chooseTarget(e.target.value)}>
          <optgroup label={t('No table')}>
            <option value="takeaway">{t('Walk-in / Takeaway')}</option>
            <option value="delivery">{t('Delivery')}</option>
          </optgroup>
          {tables?.some((x) => x.kind !== 'parcel') && (
            <optgroup label={t('Dine-in tables')}>
              {tables.filter((x) => x.kind !== 'parcel').map((tb) => <option key={tb.id} value={`t:${tb.id}`}>{tb.section ? `${tb.section} · ` : ''}{`${tableText(t, tb.number)} · ${t(tb.status === 'available' ? 'Free' : tb.status[0].toUpperCase() + tb.status.slice(1))}`}</option>)}
            </optgroup>
          )}
          {tables?.some((x) => x.kind === 'parcel') && (
            <optgroup label={t('Parcels')}>
              {tables.filter((x) => x.kind === 'parcel').map((tb) => <option key={tb.id} value={`t:${tb.id}`}>{tb.section ? `${tb.section} · ` : ''}{`${tableText(t, tb.number)} · ${t(tb.status === 'available' ? 'Free' : tb.status[0].toUpperCase() + tb.status.slice(1))}`}</option>)}
            </optgroup>
          )}
        </Select>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {!lines.length && <p className="py-10 text-center text-sm text-muted">{t('Cart is empty')}</p>}
        {lines.map((l) => {
          const was = base?.[l.key]?.quantity // a loaded order: how many there were (undefined = a new dish)
          return (
            <div key={l.key} className={`flex items-center gap-2 rounded-xl border p-2.5 ${base && was === undefined ? 'border-brand/40 bg-brand-soft/40' : 'border-line'}`}>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.code != null && <b className="mr-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand">{l.code}</b>}{l.name}</div>
                <div className="text-xs text-muted">{t('{price} each', { price: money(l.price) })}{base && (was === undefined ? <b className="ml-1.5 rounded bg-brand px-1.5 py-px text-[10px] font-bold uppercase text-white">{t('New')}</b> : was !== l.quantity ? <b className="ml-1.5 font-bold text-accent-dark">{was} → {l.quantity}</b> : null)}</div></div>
              <div className="flex items-center gap-1.5">
                <button aria-label={t('Remove one')} onClick={() => dec(l.key)} className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100">{l.quantity === 1 ? <Trash2 className="h-3.5 w-3.5 text-rose-600" /> : <Minus className="h-3.5 w-3.5" />}</button>
                <span className="w-5 text-center text-sm font-semibold">{l.quantity}</span>
                <button aria-label={t('Add one')} onClick={() => setCart((c) => ({ ...c, [l.key]: { ...l, quantity: l.quantity + 1 } }))} className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          )
        })}
        {/* dishes taken off a loaded order stay in view until saved (they go to the kitchen as a cancel slip): + puts one back */}
        {base && Object.values(base).filter((b) => !cart[b.key]).map((b) => (
          <div key={`gone-${b.key}`} className="flex items-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 p-2.5">
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-muted line-through">{b.code != null && <b className="mr-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px]">{b.code}</b>}{b.name}</div><div className="text-xs font-bold text-rose-700">{b.quantity} → 0</div></div>
            <button aria-label={t('Add one')} onClick={() => setCart((c) => ({ ...c, [b.key]: { ...b, quantity: 1 } }))} className="grid h-7 w-7 place-items-center rounded-lg bg-white text-brand ring-1 ring-line"><Plus className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-3 border-t border-line pt-3">
        <Input placeholder={t('Notes (optional)')} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-between text-sm"><span className="text-muted">{gstOn ? t('Estimated total (incl. GST)') : t('Estimated total')}</span><b className="text-lg">{money(total)}</b></div>
        {editId ? (
          <>
            {editing?.bill && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{t('This order already has a bill. It will be updated with your changes (same bill number).')}</p>}
            <div className={`grid gap-2 ${canSaveBill ? 'grid-cols-2' : ''}`}>
              <Button variant="accent" size="lg" className="w-full" disabled={!lines.length || !!busy || (isRunning && !changed && !notes.trim())} loading={busy === 'order'} onClick={() => submit(false)}>{t('Save changes')}</Button>
              {canSaveBill && <Button variant="secondary" size="lg" disabled={!lines.length || !!busy} loading={busy === 'bill'} onClick={() => submit(true)}>{t('Save & bill')}</Button>}
            </div>
          </>
        ) : (
        <div className={`grid gap-2 ${can('billing.manage') ? 'grid-cols-2' : ''}`}>
            {/* while a table's running order is still loading, nothing is sent: it is not known yet whether to add to it */}
            <Button variant="accent" size="lg" disabled={!lines.length || !!busy || waitRun} loading={busy === 'order'} onClick={() => submit(false)}>{t('Place order')}</Button>
            {can('billing.manage') && <Button variant="secondary" size="lg" disabled={!lines.length || !!busy || waitRun} loading={busy === 'bill'} onClick={() => submit(true)}>{t('Place & bill')}</Button>}
          </div>
        )}
      </div>
    </div>
  )

  const searchBox = (
    <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 h-[18px] w-[18px] text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} enterKeyHint="go" placeholder={t('Name or number')} className="min-h-10 w-full rounded-xl border border-line bg-white py-2 pl-9 pr-2 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" /></div>
  )
  const viewControls = (
    <>
      {/* one icon button that opens the native chooser: Picture cards / Compact list / Compact list without pictures / Number grid */}
      <label className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white text-brand">
        {mode === 'grid' ? <LayoutGrid className="h-5 w-5" /> : mode === 'list' ? (showImg ? <List className="h-5 w-5" /> : <ImageOff className="h-5 w-5" />) : <Hash className="h-5 w-5" />}
        <select
          aria-label={t('View')} title={t('View')} value={mode === 'list' && !showImg ? 'list-text' : mode}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'list' || v === 'list-text') { setView('list'); if ((v === 'list') !== showImg) toggleImg() } else setView(v)
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          <option value="grid">{t('Picture cards')}</option>
          <option value="list">{t('Compact list')}</option>
          <option value="list-text">{t('Compact list, no pictures')}</option>
          <option value="numbers">{t('Number grid')}</option>
        </select>
      </label>
    </>
  )
  const orderSelect = (
    <Select aria-label={t('Order for')} className="!min-h-10 !rounded-xl !px-2 !py-1 !pr-6 !text-[13px]" value={target} onChange={(e) => chooseTarget(e.target.value)}>
              <optgroup label={t('No table')}>
                <option value="takeaway">{t('Walk-in / Takeaway')}</option>
                <option value="delivery">{t('Delivery')}</option>
              </optgroup>
              {tables?.some((x) => x.kind !== 'parcel') && (
                <optgroup label={t('Dine-in tables')}>
                  {tables.filter((x) => x.kind !== 'parcel').map((tb) => <option key={tb.id} value={`t:${tb.id}`}>{`${tableText(t, tb.number)} · ${t(tb.status === 'available' ? 'Free' : tb.status[0].toUpperCase() + tb.status.slice(1))}`}</option>)}
                </optgroup>
              )}
              {tables?.some((x) => x.kind === 'parcel') && (
                <optgroup label={t('Parcels')}>
                  {tables.filter((x) => x.kind === 'parcel').map((tb) => <option key={tb.id} value={`t:${tb.id}`}>{`${tableText(t, tb.number)} · ${t(tb.status === 'available' ? 'Free' : tb.status[0].toUpperCase() + tb.status.slice(1))}`}</option>)}
                </optgroup>
              )}
            </Select>
  )

  return (
    <>
      {slot && createPortal(<div className="flex items-center gap-3"><h1 className="shrink-0 text-xl font-extrabold tracking-tight">{editId ? t('Edit order') : t('New order')}</h1><div className="min-w-0 flex-1"><div className="relative"><Search className="absolute left-3 top-2.5 h-[18px] w-[18px] text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} enterKeyHint="go" placeholder={t('Name or number')} className="min-h-10 w-full rounded-xl border border-line bg-white py-2 pl-9 pr-2 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" /></div></div><div className="flex shrink-0 items-center gap-1.5">{viewControls}</div></div>, slot)}
      {/* phones: title, "Order for" and the view controls all share the title line; the search box gets its own line */}
      {phoneSlot && createPortal(
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">{editParam ? <div className="truncate rounded-xl bg-white/90 px-3 py-2.5 text-sm font-bold text-brand">{editing?.order_no}{editing?.table ? ` · ${t('Table {n}', { n: editing.table.number })}` : ''}</div> : orderSelect}</div>
          {viewControls}
        </div>, phoneSlot)}
      <div className={`mb-2 flex items-center gap-1.5 lg:hidden ${phoneSlot ? 'hidden!' : ''}`}>
        <h1 className="shrink-0 text-[15px] font-extrabold tracking-tight">{editId ? t('Edit order') : t('New order')}</h1>
        <div className="min-w-0 flex-1">{editParam ? <div className="truncate rounded-xl bg-brand-soft px-3 py-2.5 text-sm font-bold text-brand">{editing?.order_no}{editing?.table ? ` · ${t('Table {n}', { n: editing.table.number })}` : ''}</div> : orderSelect}</div>
        {viewControls}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] min-[1180px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="@container min-w-0">
          <div className="lg:hidden">
            {/* fixed line (does not scroll): search bar + the first two categories */}
            <div className="mb-1.5 flex items-center gap-1">
              <div className="relative min-w-[7rem] flex-1"><Search className="absolute left-3 top-2.5 h-[18px] w-[18px] text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} enterKeyHint="go" placeholder={t('Name or number')} className="min-h-10 w-full rounded-xl border border-line bg-white py-2 pl-9 pr-2 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" /></div>
              {(cats || []).slice(0, 2).map((c) => (
                <button key={c.id} type="button" aria-pressed={cat === String(c.id)} onClick={() => setCat(String(c.id))} className={`min-h-10 max-w-[6.4rem] shrink-0 truncate rounded-full px-3 text-[13px] font-semibold transition active:scale-95 ${cat === String(c.id) ? 'bg-brand text-white shadow-[0_6px_14px_-6px_rgb(23_100_95/.55)]' : 'bg-white text-slate-600 shadow-sm ring-1 ring-line'}`}>{cn(c)}</button>
              ))}
            </div>
            {/* the other categories: two lines that scroll sideways */}
            <Chips rows={(cats || []).length < 6 ? 1 : 2} value={cat} onChange={setCat} items={[['all', t('All')], ...(cats || []).slice(2).map((c) => [String(c.id), cn(c)])]} />
          </div>
          <div className="hidden lg:block">
          <div className={`mb-2 flex items-center gap-3 ${slot ? 'hidden' : ''}`}><h1 className="shrink-0 text-2xl font-extrabold tracking-tight">{editId ? t('Edit order') : t('New order')}</h1>{slot ? <div className="min-w-0 flex-1" /> : searchBox}
              <div className="hidden items-center gap-1.5 lg:flex">{viewControls}</div>
            </div>
            <Chips rows={(cats || []).length <= 8 ? 1 : 2} value={cat} onChange={setCat} items={[['all', t('All')], ...(cats || []).map((c) => [String(c.id), cn(c)])]} />
          </div>
          {exact && (
            <button type="button" onClick={() => quickAdd(exact)} className="animate-pop mb-3 flex w-full items-center gap-3 rounded-2xl bg-brand p-3 text-left text-white shadow-float active:scale-[.98]">
              <span className="grid h-12 min-w-12 place-items-center rounded-xl bg-white/20 px-2 text-2xl font-extrabold">{exact.code}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-base font-bold">{nm(exact).main}</span>{nm(exact).sub && <span className="block truncate text-sm opacity-90">{nm(exact).sub}</span>}<span className="text-sm opacity-90">{money(exact.price)}{exact.variants?.length ? ` ${t('+ variants')}` : ''}</span></span>
              <span className="flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-sm font-extrabold text-brand"><Plus className="h-4 w-4" />{t('Add')}</span>
            </button>
          )}
          {mode === 'numbers' ? (
            <div className="space-y-5">
              {(cats || []).filter((c) => list.some((i) => i.category_id === c.id)).map((c) => {
                const inCat = list.filter((i) => i.category_id === c.id)
                return (
                  <section key={c.id}>
                    <h3 className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-muted"><span>{cn(c)}</span><span className="h-px flex-1 bg-line" /><span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-line">{inCat.length}</span></h3>
                    <div className="grid grid-cols-3 gap-2.5 min-[400px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6">
                      {inCat.map((i) => {
                        const n = qtyOf(i.id)
                        return (
                          <div key={i.id} role="button" tabIndex={0} onClick={() => tapItem(i)} className={`relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-2xl border bg-white p-1.5 text-center shadow-card transition active:scale-90 ${n ? 'border-brand bg-brand-soft ring-2 ring-brand/30' : 'border-line/70'}`}>
                            <i className={`absolute left-2 top-2 h-2 w-2 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} />
                            <span className={`text-[1.75rem] font-extrabold leading-none tracking-tight ${n ? 'text-brand' : ''}`}>{i.code ?? '·'}</span>
                            <span className="mt-1 line-clamp-2 w-full break-words text-[11px] font-semibold leading-tight text-muted">{nm(i).main}</span>
                            {nm(i).sub && <span className="w-full truncate text-[10px] leading-tight text-muted/80">{nm(i).sub}</span>}
                            {n > 0 && <b className="animate-pop absolute right-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1 text-xs text-white shadow">{n}</b>}
                            {n > 0 && <span role="button" tabIndex={0} aria-label={t('Remove one')} onClick={(e) => { e.stopPropagation(); dec(lastKeyOf(i.id)) }} className="absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-lg bg-white/90 text-slate-700 shadow active:scale-90"><Minus className="h-4 w-4" /></span>}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
          <div className={asGrid ? 'grid grid-cols-2 gap-3 @[30rem]:grid-cols-3 @[44rem]:grid-cols-4 @[58rem]:grid-cols-5 @[72rem]:grid-cols-6' : 'grid gap-2.5 @[38rem]:grid-cols-2 @[58rem]:grid-cols-3 @[84rem]:grid-cols-4'}>
            {list.map((i) => {
              const n = qtyOf(i.id)
              // − n + : a light − button, the count in brand colour, and a dark + button (level with the price in the photo card; at the right of the list row)
              const stepper = n > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <span role="button" tabIndex={0} aria-label={t('Remove one')} onClick={() => dec(lastKeyOf(i.id))} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-brand transition hover:bg-slate-200 active:scale-90"><Minus className="h-4 w-4" /></span>
                  <b className="min-w-5 text-center text-base text-brand tabular-nums">{n}</b>
                  <span role="button" tabIndex={0} aria-label={t('Add one')} onClick={() => tapItem(i)} className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white shadow-sm transition hover:bg-brand-dark active:scale-90"><Plus className="h-4 w-4" /></span>
                </span>
              )
              // nothing in the cart yet: an ADD button (it turns into the pill above once tapped)
              const addBtn = (
                <span role="button" tabIndex={0} aria-label={t('Add')} onClick={(e) => { e.stopPropagation(); tapItem(i) }} className="inline-flex h-8 shrink-0 items-center rounded-full border-2 border-brand bg-white px-4 text-sm font-extrabold uppercase tracking-wide text-brand transition hover:bg-brand hover:text-white active:scale-95">{t('Add')}</span>
              )
              const dot = <i className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} />
              const price = <>{money(i.price)}{i.variants?.length ? <span className="ml-1 text-[11px] font-normal text-muted">{t('+ variants')}</span> : null}</>
              return asGrid ? (
                <div key={i.id} role="button" tabIndex={0} onClick={() => tapItem(i)} className={`group relative overflow-hidden rounded-[1.25rem] border bg-white text-left shadow-card transition hover:shadow-lg active:scale-[.98] ${n ? 'border-brand ring-2 ring-brand/20' : 'border-line/70'}`}>
                  {i.code != null && <span className="absolute left-2 top-2 z-10 grid h-7 min-w-7 place-items-center rounded-lg bg-brand px-1.5 text-xs font-extrabold leading-none text-white shadow">{i.code}</span>}
                  {/* the photo stays completely clear: the ADD / − n + control lives in the bottom row, level with the price */}
                  <div className="relative">
                    {i.image_url ? <Img src={i.image_url} thumb className="h-28 w-full object-cover" /> : <div className="grid h-28 place-items-center bg-brand-soft"><UtensilsCrossed className="h-10 w-10 text-brand/40" strokeWidth={1.6} /></div>}
                  </div>
                  <div className="p-2.5">
                    {/* Marathi name first, English underneath (a dish with no Marathi name shows just English); both lines keep their height so every card is the same size */}
                    <div className="flex items-center gap-1.5">{dot}<span className="truncate text-[15px] font-bold leading-snug">{i.name_mr || i.name}</span></div>
                    <div className="min-h-4 truncate pl-4 text-xs leading-4 text-muted">{i.name_mr ? i.name : ''}</div>
                    <div className="mt-2 flex min-h-8 flex-wrap items-center justify-between gap-x-1.5 gap-y-1.5"><span className="text-[15px] font-extrabold text-brand">{price}</span><span className="ml-auto">{stepper || addBtn}</span></div>
                  </div>
                </div>
              ) : (
                <div key={i.id} role="button" tabIndex={0} onClick={() => tapItem(i)} className={`flex h-[4.5rem] items-center gap-3 overflow-hidden rounded-2xl border bg-white text-left shadow-card transition active:scale-[.98] ${i.image_url && showImg ? 'pl-0 pr-4' : 'px-4'} ${n ? 'border-brand ring-2 ring-brand/20' : 'border-line/70'}`}>
                  {i.image_url && showImg ? <Img src={i.image_url} thumb className="h-full w-[4.5rem] shrink-0 object-cover" /> : dot}
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5">{i.code != null && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-md bg-brand px-1 text-[10px] font-extrabold leading-none text-white">{i.code}</span>}{i.image_url && showImg && dot}<span className="truncate text-[15px] font-semibold">{nm(i).main}</span></div>{i.name_mr && <div className="-mt-0.5 truncate text-xs text-muted">{i.name_mr}</div>}<div className="text-sm font-semibold text-brand">{price}</div></div>
                  {stepper || <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Plus className="h-5 w-5" /></span>}
                </div>
              )
            })}
          </div>
          )}
          {!list.length && <p className="py-10 text-center text-sm text-muted">{t('No dishes found')}</p>}
        </div>
        <div className="hidden lg:block"><div className="sticky top-[4.25rem] h-[calc(100vh-5rem)] rounded-2xl border border-line bg-white p-4 shadow-card">{Cart}</div></div>
      </div>

      {count > 0 && (
        <button onClick={() => setCartOpen(true)} className="animate-pop fixed inset-x-4 bottom-[7.25rem] z-30 flex items-center justify-between rounded-[1.25rem] bg-accent px-5 py-4 text-white shadow-float lg:hidden">
          <span className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />{t('{n} item(s)', { n: count })}</span><b>{money(total)}</b>
        </button>
      )}
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title={t('Your order')}><div className="h-[70dvh]">{Cart}</div></Modal>

      <Modal open={!!askKot} onClose={() => answerKot(false)} title={t(askKot?.title || 'Order placed')}>
        {askKot && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted">{t('Sent to kitchen — KOT #{n}', { n: askKot.kots.map((k) => k.number).join(', #') })}</p>
            <div className="text-lg font-extrabold">{t('Print the kitchen slip now?')}</div>
            <Button size="lg" className="w-full" loading={printing} onClick={() => answerKot(true)}><Printer className="h-5 w-5" /> {t('Yes – print KOT')}</Button>
            <Button size="lg" variant="secondary" className="w-full" disabled={printing} onClick={() => answerKot(false)}>{t('Not now')}</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!offlineBill} onClose={() => setOfflineBill(null)} title={t('Bill (saved offline)')}>
        {offlineBill && (
          <div className="space-y-3">
            <p className="rounded-2xl bg-accent-soft px-3.5 py-2.5 text-xs font-semibold leading-snug text-accent-dark">{t('This bill has a temporary number. It is saved on this device and will be sent when the internet is back. Collect the payment in Bills after that.')}</p>
            <Receipt data={offlineBill} />
          </div>
        )}
      </Modal>

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? nm(pick).main : ''}>
        <div className="space-y-2">
          {pick && [{ id: null, name: baseVariantName(pick, lang, t('Regular')), price: pick.price }, ...pick.variants.map((v) => ({ ...v, name: variantName(v, lang), orig: v }))].map((v) => (
            <button key={v.id ?? 'base'} onClick={() => { add(pick, v.id ? v.orig : null); setPick(null) }} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-sm hover:border-brand"><span>{v.name}</span><b>{money(v.price)}</b></button>
          ))}
        </div>
      </Modal>
    </>
  )
}
