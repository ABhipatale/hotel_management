import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, CheckCircle2, ChefHat, ChevronRight, Clock, Flame, Minus, Plus, Search, ShoppingCart, UtensilsCrossed } from 'lucide-react'
import { api, errMsg } from '../../lib/api'
import { applyBrand } from '../../lib/branding'
import { money } from '../../lib/format'
import { Button, Input, Modal, Spinner } from '../../components/ui'
import LangSwitch from '../../components/LangSwitch'
import { useI18n } from '../../i18n'
import { baseVariantName, catName, dishNames, variantName } from '../../lib/dishName'
import { devUrl, thumbOf } from '../../lib/image'

/** A dish photo (own or platform library). No photo, or one that fails to load, shows a soft tile with the dish's first letter. */
function DishPhoto({ src, name }) {
  const full = src ? devUrl(src) : null
  const [url, setUrl] = useState(() => (full ? thumbOf(full) : null))
  const [bad, setBad] = useState(false)
  if (!full || bad) return <div className="grid aspect-square w-full place-items-center bg-gradient-to-br from-brand-soft to-ivory"><span className="text-3xl font-extrabold text-brand/25">{name?.[0]}</span></div>
  return <img src={url} alt="" loading="lazy" decoding="async" onError={() => (url !== full ? setUrl(full) : setBad(true))} className="aspect-square w-full bg-brand-soft object-cover" />
}

const STEPS = [['pending', 'Received'], ['accepted', 'Accepted'], ['preparing', 'Cooking'], ['ready', 'Ready'], ['served', 'Served']]

/** Public, unauthenticated customer menu. Tenant comes from the URL slug + secret table token (validated server-side). */
export default function QrMenu() {
  const { t, lang, setDefault } = useI18n()
  const { slug, token } = useParams()
  const base = `/public/menu/${slug}/table/${token}`
  const [menu, setMenu] = useState(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [veg, setVeg] = useState(false)
  const [logoBad, setLogoBad] = useState(false)
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
      setDefault(r.data.company?.default_language)
    }).catch((e) => setError(e.response?.status === 404 ? 'This QR code is not valid or the restaurant is currently unavailable.' : errMsg(e)))
  }, [base, setDefault])

  const loadOrders = useCallback(() => api.get(`${base}/orders`).then((r) => setOrders(r.data)).catch(() => {}), [base])
  useEffect(() => {
    if (!menu) return
    loadOrders()
    const t = setInterval(() => { if (!document.hidden) loadOrders() }, 6000) // not while the phone is locked / the tab is hidden
    const onVisible = () => { if (!document.hidden) loadOrders() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [menu, loadOrders])

  const list = useMemo(() => (menu?.items || []).filter((i) => (cat === 'all' || i.category_id === +cat) && (!veg || i.is_veg) && (i.name.toLowerCase().includes(q.toLowerCase()) || (i.name_mr || '').toLowerCase().includes(q.toLowerCase()))), [menu, cat, q, veg])
  // "All": group dishes under their category heading; a single category / search: one flat list
  const groups = useMemo(() => {
    if (cat !== 'all' || q) return [{ id: 'x', name: '', items: list }]
    const g = (menu?.categories || []).map((c) => ({ id: c.id, name: catName(c, lang), items: list.filter((i) => i.category_id === c.id) }))
    const rest = list.filter((i) => !(menu?.categories || []).some((c) => c.id === i.category_id))
    return [...g, ...(rest.length ? [{ id: 'o', name: t('Other'), items: rest }] : [])].filter((x) => x.items.length)
  }, [menu, list, cat, q, lang, t])
  const anyPhoto = (menu?.items || []).some((i) => i.image_url || i.image_path) // a menu without photos gets compact cards (no empty picture tiles)
  const lines = Object.values(cart)
  const count = lines.reduce((a, l) => a + l.quantity, 0)
  const gstOn = menu?.company?.gst_enabled !== false
  const total = lines.reduce((a, l) => a + l.price * l.quantity * (1 - l.discount / 100) * (1 + (gstOn ? l.gst : 0) / 100), 0)
  const unit = (i, v) => +(v?.price ?? i.price) * (1 - i.discount_percent / 100)

  const add = (i, v) => {
    const key = `${i.id}:${v?.id || 0}`
    setCart((c) => ({ ...c, [key]: { key, food_item_id: i.id, variant_id: v?.id, name: i.name + ((v ? v.name : i.variants?.length && i.base_variant_name) ? ` (${v ? v.name : i.base_variant_name})` : ''), price: +(v?.price ?? i.price), discount: +i.discount_percent, gst: +i.gst_percent, quantity: (c[key]?.quantity || 0) + 1 } }))
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

  if (error && !menu) return <div className="grid min-h-full place-items-center p-6 text-center"><div><UtensilsCrossed className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="max-w-xs text-muted">{t(error)}</p><LangSwitch className="mt-5" /></div></div>
  if (!menu) return <Spinner />
  const { company } = menu

  const latest = orders[0]
  const stepLabel = latest ? STEPS[Math.max(0, STEPS.findIndex(([x]) => x === latest.status))][1] : ''

  return (
    <div className="min-h-full bg-canvas pb-32">
      {/* Compact header: logo, name, table and language in one row */}
      <div className="relative overflow-hidden bg-brand px-4 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
        <div className="relative mx-auto flex max-w-4xl items-center gap-3">
          {company.logo_url && !logoBad ? <img src={company.logo_url} alt="" decoding="async" onError={() => setLogoBad(true)} className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain p-1" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ivory text-xl font-extrabold text-brand">{company.name[0]}</div>}
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate text-lg font-extrabold tracking-tight">{company.name}</h1>
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-white/80"><UtensilsCrossed className="h-3 w-3" />{t('Table {n}', { n: menu.table.number })}</span>
          </div>
          <LangSwitch tone="dark" className="shrink-0 [&_svg]:hidden" />
        </div>
      </div>

      <div className="mx-auto max-w-4xl">
      {/* Search floats over the hero edge; only the category bar sticks while scrolling */}
      <div className="relative z-10 -mt-3.5 px-4">
        <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-lift ring-1 ring-line/70">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search dishes')} className="min-h-11 w-full rounded-xl bg-canvas pl-10 pr-3 text-[16px] outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-brand" /></div>
          <button onClick={() => setVeg(!veg)} aria-pressed={veg} className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-extrabold transition active:scale-95 ${veg ? 'bg-emerald-600 text-white' : 'bg-canvas text-ink'}`}><i className={`h-3.5 w-3.5 rounded-sm border-2 ${veg ? 'border-white bg-white/30' : 'border-emerald-600 bg-emerald-500'}`} />{t('Veg only')}</button>
        </div>
      </div>
      <div className="sticky top-0 z-20 bg-canvas/90 px-4 pb-2 pt-2.5 backdrop-blur-md">
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {[['all', t('All')], ...menu.categories.map((c) => [String(c.id), catName(c, lang)])].map(([k, label]) => (
            <button key={k} onClick={() => setCat(k)} aria-pressed={cat === k} className={`min-h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-bold transition active:scale-95 ${cat === k ? 'bg-brand text-white shadow-card' : 'bg-white text-slate-600 ring-1 ring-line'}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* Live order status strip */}
      {latest && (
        <button onClick={() => setTrackOpen(true)} className="mx-4 mt-2 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-left ring-1 ring-accent/20 transition active:scale-[.99]">
          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white"><ChefHat className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-extrabold text-ink">{t('My orders')} · {latest.order_no}</span><span className="text-xs font-semibold text-accent-dark">{t(stepLabel)}</span></span>
          <Clock className="h-4 w-4 shrink-0 text-accent-dark" />
        </button>
      )}

      <div className="space-y-4 px-4 pt-1">
        {groups.map((g) => (
          <section key={g.id} className="space-y-3">
            {g.name && <h2 className="flex items-center gap-2 px-1 pt-2 text-[13px] font-extrabold uppercase tracking-wider text-brand"><span>{g.name}</span><span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] tracking-normal">{g.items.length}</span><i className="h-px flex-1 bg-line" /></h2>}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6">
        {g.items.map((i, idx) => {
          const qty = lines.filter((l) => l.food_item_id === i.id).reduce((a, l) => a + l.quantity, 0)
          const key = `${i.id}:0`
          const off = +i.discount_percent > 0
          const photo = i.image_url || (i.image_path ? `${location.origin}/storage/${i.image_path}` : null)
          const names = dishNames(i, lang)
          return (
            <div key={i.id} onClick={() => (i.variants.length ? setPick(i) : add(i))} style={{ animationDelay: `${Math.min(idx, 9) * 25}ms` }} className={`animate-pop flex cursor-pointer select-none flex-col overflow-hidden rounded-2xl bg-white shadow-card transition active:scale-[.97] ${qty > 0 ? 'ring-2 ring-brand' : 'ring-1 ring-line/60'}`}>
              {anyPhoto && <div className="relative">
                <DishPhoto src={photo} name={names.main} />
                <span className="absolute left-1.5 top-1.5 grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-white/95 shadow-card"><i className={`grid h-3 w-3 place-items-center rounded-[2px] border-[1.5px] ${i.is_veg ? 'border-emerald-600' : 'border-rose-600'}`}><b className={`h-1 w-1 rounded-full ${i.is_veg ? 'bg-emerald-600' : 'bg-rose-600'}`} /></i></span>
                {off && <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-white shadow-card">{Math.round(i.discount_percent)}% {t('OFF')}</span>}
              </div>}
              <div className="flex flex-1 flex-col p-2">
                <div className="flex items-start gap-1">
                  {!anyPhoto && <i className={`mt-[3px] grid h-3 w-3 shrink-0 place-items-center rounded-[2px] border-[1.5px] ${i.is_veg ? 'border-emerald-600' : 'border-rose-600'}`}><b className={`h-1 w-1 rounded-full ${i.is_veg ? 'bg-emerald-600' : 'bg-rose-600'}`} /></i>}
                  <div className={`${anyPhoto ? 'line-clamp-2' : 'line-clamp-3'} text-[12.5px] font-extrabold leading-tight`}>{names.main}</div>
                </div>
                {/* the Marathi name sits right under the English one (Devanagari has built-in space above its letters, so pull it up) */}
                {names.sub && <div className={`-mt-[2px] line-clamp-1 text-[10.5px] leading-tight text-muted ${anyPhoto ? '' : 'pl-4'}`}>{names.sub}</div>}
                <div className="mt-auto flex flex-wrap items-baseline gap-x-1 pt-1.5"><b className="text-[13px] leading-tight text-brand">{money(unit(i))}</b>{off && <s className="text-[10px] text-muted">{money(i.price)}</s>}{off && !anyPhoto && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-white">{Math.round(i.discount_percent)}% {t('OFF')}</span>}</div>
                {i.variants.length > 0 && <div className="text-[10px] font-semibold text-muted">{t('{n} sizes', { n: i.variants.length + 1 })}</div>}
                <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                  {qty > 0 && !i.variants.length ? (
                    <div className="flex h-9 items-center justify-between rounded-lg bg-brand text-white">
                      <button onClick={() => change(key, -1)} aria-label={t('Remove one')} className="grid h-9 w-9 place-items-center rounded-lg active:bg-white/15"><Minus className="h-4 w-4" strokeWidth={3} /></button>
                      <b className="text-[13px]">{qty}</b>
                      <button onClick={() => add(i)} aria-label={t('Add one')} className="grid h-9 w-9 place-items-center rounded-lg active:bg-white/15"><Plus className="h-4 w-4" strokeWidth={3} /></button>
                    </div>
                  ) : (
                    <button onClick={() => (i.variants.length ? setPick(i) : add(i))} className={`h-9 w-full rounded-lg text-[13px] font-extrabold ring-1 transition active:scale-95 ${qty ? 'bg-brand text-white ring-brand' : 'bg-brand-soft text-brand ring-brand/20'}`}>{qty ? t('ADDED · {n}', { n: qty }) : t('ADD')}</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
          </div>
          </section>
        ))}
        {!list.length && <div className="py-16 text-center"><UtensilsCrossed className="mx-auto mb-3 h-10 w-10 text-slate-300" strokeWidth={1.5} /><p className="text-sm font-semibold text-muted">{t('No dishes found')}</p></div>}
        <p className="pt-2 text-center text-[11px] text-muted/70">{t('Scan · Order · Enjoy')}</p>
      </div>

      </div>

      {count > 0 && (
        <button onClick={() => setCartOpen(true)} className="animate-pop fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 mx-auto flex min-h-16 max-w-lg items-center justify-between gap-3 rounded-[1.25rem] bg-brand px-4 py-3 text-white shadow-float ring-1 ring-white/10 transition active:scale-[.98]">
          <span className="flex items-center gap-3"><span className="relative grid h-11 w-11 place-items-center rounded-xl bg-white/15"><ShoppingCart className="h-5 w-5" /><span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-extrabold ring-2 ring-brand">{count}</span></span><span className="text-left leading-tight"><span className="block text-xs text-white/70">{t('View cart')}</span><b className="text-lg">{money(total)}</b></span></span>
          <span className="flex items-center gap-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-extrabold">{t('Place order')}<ChevronRight className="h-4 w-4" /></span>
        </button>
      )}

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? dishNames(pick, lang).main : ''}>
        {pick && [{ id: null, name: baseVariantName(pick, lang, t('Regular')), price: pick.price }, ...pick.variants.map((v) => ({ ...v, name: variantName(v, lang), orig: v }))].map((v) => (
          <button key={v.id ?? 'base'} onClick={() => { add(pick, v.id ? v.orig : null); setPick(null) }} className="mb-2 flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-sm"><span>{v.name}</span><b>{money(unit(pick, v.orig || v))}</b></button>
        ))}
      </Modal>

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title={t('Your cart')}>
        <div className="space-y-4">
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-3 rounded-2xl bg-canvas p-3 ring-1 ring-line">
                <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-sm font-extrabold">{l.name}</div><div className="mt-0.5 text-sm font-bold text-brand">{money(l.price * l.quantity * (1 - l.discount / 100))}</div></div>
                <div className="flex items-center rounded-xl bg-white p-0.5 shadow-card ring-1 ring-line">
                  <button onClick={() => change(l.key, -1)} aria-label={t('Remove one')} className="grid h-10 w-10 place-items-center rounded-lg text-brand active:bg-brand-soft"><Minus className="h-4 w-4" strokeWidth={3} /></button>
                  <b className="w-7 text-center">{l.quantity}</b>
                  <button onClick={() => change(l.key, 1)} aria-label={t('Add one')} className="grid h-10 w-10 place-items-center rounded-lg bg-brand text-white active:bg-brand-dark"><Plus className="h-4 w-4" strokeWidth={3} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Your name (optional)')} value={cust.customer_name} onChange={(e) => setCust({ ...cust, customer_name: e.target.value })} />
            <Input label={t('Mobile (optional)')} inputMode="tel" value={cust.customer_phone} onChange={(e) => setCust({ ...cust, customer_phone: e.target.value })} />
          </div>
          <Input label={t('Cooking instructions')} value={cust.notes} onChange={(e) => setCust({ ...cust, notes: e.target.value })} />
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{t(error)}</p>}
          <div className="rounded-2xl bg-brand-soft/70 p-4">
            <div className="flex items-end justify-between"><span className="text-sm font-bold text-brand">{t('Total')}</span><b className="text-2xl text-brand">{money(total)}</b></div>
            <p className="mt-1 text-xs text-muted">{gstOn ? t('Total incl. GST (final bill is calculated at billing)') : t('Total (final bill is calculated at billing)')}</p>
          </div>
          <Button variant="accent" size="lg" className="w-full" loading={busy} onClick={place}>{t('Place order')}</Button>
        </div>
      </Modal>

      <Modal open={trackOpen} onClose={() => setTrackOpen(false)} title={t('Your orders')}>
        {!orders.length ? <p className="py-6 text-center text-sm text-muted">{t('No active orders')}</p> : orders.map((o) => {
          const idx = Math.max(0, STEPS.findIndex(([s]) => s === o.status))
          const done = o.status === 'ready' || o.status === 'served'
          return (
            <div key={o.id} className="mb-4 overflow-hidden rounded-[1.25rem] ring-1 ring-line">
              <div className={`flex items-center gap-3 px-4 py-3.5 ${done ? 'bg-emerald-600 text-white' : 'bg-brand text-white'}`}>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/20">{done ? <CheckCircle2 className="h-5 w-5" /> : <ChefHat className="h-5 w-5" />}</span>
                <div className="min-w-0 flex-1 leading-tight"><div className="text-[11px] font-semibold text-white/70">{o.order_no}</div><div className="text-base font-extrabold">{t(STEPS[idx][1])}</div></div>
              </div>
              <div className="flex items-start px-3 pt-4">
                {STEPS.map(([s, l], i) => (
                  <div key={s} className="relative flex flex-1 flex-col items-center">
                    {i > 0 && <span className={`absolute right-1/2 top-[9px] h-1 w-full ${i <= idx ? 'bg-brand' : 'bg-slate-200'}`} />}
                    <span className={`relative z-10 grid h-5 w-5 place-items-center rounded-full ring-4 ring-white ${i <= idx ? 'bg-brand text-white' : 'bg-slate-200'}`}>{i < idx && <Check className="h-3 w-3" strokeWidth={3.5} />}{i === idx && <span className="h-2 w-2 rounded-full bg-white" />}</span>
                    <span className={`mt-1.5 text-center text-[10px] leading-tight ${i === idx ? 'font-extrabold text-brand' : 'text-muted'}`}>{t(l)}</span>
                  </div>
                ))}
              </div>
              <ul className="mt-3 space-y-1 border-t border-line bg-canvas/60 px-4 py-3 text-sm">{o.items.map((i) => <li key={i.id} className="flex gap-2"><b className="text-brand">{i.quantity}×</b><span>{i.name}{i.variant ? ` (${i.variant})` : ''}</span></li>)}</ul>
            </div>
          )
        })}
        <Button variant="secondary" className="mt-1 w-full" onClick={() => setTrackOpen(false)}>{t('Order more')}</Button>
      </Modal>
    </div>
  )
}
