import { useMemo, useState } from 'react'
import Img from '../../components/Img'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Hash, ImageOff, Image as ImageIcon, LayoutGrid, List, Minus, Plus, Search, ShoppingCart, Trash2, UtensilsCrossed } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useI18n } from '../../i18n'
import { catName, dishNames } from '../../lib/dishName'
import { Button, Chips, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

/** Waiter POS: pick table → add items → place order. Totals here are an estimate; the server prices the order. */
export default function NewOrder() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const { t, lang } = useI18n()
  const nm = (i) => dishNames(i, lang)
  const cn = (c) => catName(c, lang)
  const { can, company, user } = useAuth()
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

  const add = (item, variant) => {
    const key = `${item.id}:${variant?.id || 0}`
    setCart((c) => ({
      ...c,
      [key]: { key, food_item_id: item.id, code: item.code, variant_id: variant?.id, name: item.name + (variant ? ` (${variant.name})` : ''), price: +(variant?.price ?? item.price), discount: +item.discount_percent, gst: +item.gst_percent, quantity: (c[key]?.quantity || 0) + 1 },
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
      <div className="mb-3 hidden lg:block">
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
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.code != null && <b className="mr-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand">{l.code}</b>}{l.name}</div><div className="text-xs text-muted">{t('{price} each', { price: money(l.price) })}</div></div>
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

  const viewControls = (
    <>
      {/* icon button that opens the native chooser: Picture cards / Compact list / Number grid */}
      <label className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white text-brand">
        {mode === 'grid' ? <LayoutGrid className="h-5 w-5" /> : mode === 'list' ? <List className="h-5 w-5" /> : <Hash className="h-5 w-5" />}
        <select aria-label={t('View')} title={t('View')} value={mode} onChange={(e) => setView(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          <option value="grid">{t('Picture cards')}</option>
          <option value="list">{t('Compact list')}</option>
          <option value="numbers">{t('Number grid')}</option>
        </select>
      </label>
      {mode === 'list' && (
        <button type="button" aria-pressed={showImg} aria-label={showImg ? t('Hide pictures') : t('Show pictures')} title={showImg ? t('Hide pictures') : t('Show pictures')} onClick={toggleImg} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition active:scale-90 ${showImg ? 'border-brand bg-brand text-white' : 'border-line bg-white text-muted'}`}>
          {showImg ? <ImageIcon className="h-5 w-5" /> : <ImageOff className="h-5 w-5" />}
        </button>
      )}
    </>
  )
  const orderSelect = (
    <Select aria-label={t('Order for')} className="!min-h-10 !rounded-xl !px-2 !py-1 !pr-6 !text-[13px]" value={target} onChange={(e) => setTarget(e.target.value)}>
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
  )

  return (
    <>
      <div className="hidden lg:block"><PageHeader title={t('New order')} /></div>
      {/* phones: title, "Order for" and the view controls all share the title line; the search box gets its own line */}
      <div className="mb-2 flex items-center gap-1.5 lg:hidden">
        <h1 className="shrink-0 text-[15px] font-extrabold tracking-tight">{t('New order')}</h1>
        <div className="min-w-0 flex-1">{orderSelect}</div>
        {viewControls}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="lg:hidden">
            {/* fixed line (does not scroll): search bar + the first two categories */}
            <div className="mb-1.5 flex items-center gap-1">
              <div className="relative min-w-[7rem] flex-1"><Search className="absolute left-3 top-2.5 h-[18px] w-[18px] text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} enterKeyHint="go" placeholder={t('Name or number')} className="min-h-10 w-full rounded-xl border border-line bg-white py-2 pl-9 pr-2 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" /></div>
              {(cats || []).slice(0, 2).map((c) => (
                <button key={c.id} type="button" aria-pressed={cat === String(c.id)} onClick={() => setCat(String(c.id))} className={`min-h-10 max-w-[6.4rem] shrink-0 truncate rounded-full px-3 text-[13px] font-semibold transition active:scale-95 ${cat === String(c.id) ? 'bg-brand text-white shadow-[0_6px_14px_-6px_rgb(23_100_95/.55)]' : 'bg-white text-slate-600 shadow-sm ring-1 ring-line'}`}>{cn(c)}</button>
              ))}
            </div>
            {/* the other categories: two lines that scroll sideways */}
            <Chips rows={2} value={cat} onChange={setCat} items={[['all', t('All')], ...(cats || []).slice(2).map((c) => [String(c.id), cn(c)])]} />
          </div>
          <div className="hidden lg:block">
          <div className="mb-2 flex items-center gap-1.5"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 h-[18px] w-[18px] text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} enterKeyHint="go" placeholder={t('Name or number')} className="min-h-10 w-full rounded-xl border border-line bg-white py-2 pl-9 pr-2 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" /></div>
              <div className="hidden items-center gap-1.5 lg:flex">{viewControls}</div>
            </div>
            <Chips rows={2} value={cat} onChange={setCat} items={[['all', t('All')], ...(cats || []).map((c) => [String(c.id), cn(c)])]} />
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
          <div className={asGrid ? 'grid grid-cols-2 gap-3 md:grid-cols-3' : 'grid gap-2.5 md:grid-cols-2'}>
            {list.map((i) => {
              const n = qtyOf(i.id)
              const stepper = n > 0 && (
                <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <span role="button" tabIndex={0} aria-label={t('Remove one')} onClick={() => dec(lastKeyOf(i.id))} className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 active:scale-90"><Minus className="h-4 w-4" /></span>
                  <b className="w-6 text-center text-base">{n}</b>
                  <span role="button" tabIndex={0} aria-label={t('Add one')} onClick={() => tapItem(i)} className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white active:scale-90"><Plus className="h-4 w-4" /></span>
                </span>
              )
              const dot = <i className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} />
              const price = <>{money(i.price)}{i.variants?.length ? <span className="ml-1 text-[11px] font-normal text-muted">{t('+ variants')}</span> : null}</>
              return asGrid ? (
                <div key={i.id} role="button" tabIndex={0} onClick={() => tapItem(i)} className={`relative overflow-hidden rounded-[1.25rem] border bg-white text-left shadow-card transition active:scale-[.97] ${n ? 'border-brand ring-2 ring-brand/20' : 'border-line/70'}`}>
                  {i.code != null && <span className="absolute left-2 top-2 z-10 grid h-7 min-w-7 place-items-center rounded-lg bg-brand px-1.5 text-xs font-extrabold leading-none text-white shadow">{i.code}</span>}
                  {i.image_url ? <Img src={i.image_url} thumb className="h-28 w-full object-cover" /> : <div className="grid h-28 place-items-center bg-brand-soft"><UtensilsCrossed className="h-10 w-10 text-brand/40" strokeWidth={1.6} /></div>}
                  <div className="p-3">
                    <div className="flex items-center gap-1.5">{dot}<span className="truncate text-sm font-medium">{nm(i).main}</span></div>
                    {nm(i).sub && <div className="truncate text-xs text-muted">{nm(i).sub}</div>}
                    <div className="mt-1 flex min-h-9 items-center justify-between gap-2 text-sm font-semibold text-brand"><span>{price}</span>{stepper}</div>
                  </div>
                </div>
              ) : (
                <div key={i.id} role="button" tabIndex={0} onClick={() => tapItem(i)} className={`flex h-[4.5rem] items-center gap-3 overflow-hidden rounded-2xl border bg-white text-left shadow-card transition active:scale-[.98] ${i.image_url && showImg ? 'pl-0 pr-4' : 'px-4'} ${n ? 'border-brand ring-2 ring-brand/20' : 'border-line/70'}`}>
                  {i.image_url && showImg ? <Img src={i.image_url} thumb className="h-full w-[4.5rem] shrink-0 object-cover" /> : dot}
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5">{i.code != null && <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-brand px-1.5 text-[11px] font-extrabold leading-none text-white">{i.code}</span>}{i.image_url && showImg && dot}<span className="truncate text-[15px] font-semibold">{nm(i).main}</span></div>{i.name_mr && <div className="truncate text-xs text-muted">{i.name_mr}</div>}<div className="text-sm font-semibold text-brand">{price}</div></div>
                  {stepper || <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Plus className="h-5 w-5" /></span>}
                </div>
              )
            })}
          </div>
          )}
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
