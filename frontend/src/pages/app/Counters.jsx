import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Banknote, Pencil, Plus, Receipt, ShoppingBag, Store, TrendingDown, TrendingUp, Users, Armchair, Wallet, UserPlus } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useCounter } from '../../context/CounterContext'
import { useToast } from '../../context/ToastContext'
import { useT } from '../../i18n'
import { Badge, Button, Card, Chips, Input, Modal, PageHeader, Spinner, Switch, cx } from '../../components/ui'

const iso = (d) => d.toISOString().slice(0, 10)
const RANGES = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month']]
const rangeDates = (k) => {
  const to = new Date()
  const from = new Date()
  if (k === 'week') from.setDate(from.getDate() - 6)
  if (k === 'month') from.setDate(1)
  return { from: iso(from), to: iso(to) }
}

/** Smoothly counts a number up when it changes (feels alive, costs nothing). */
function useCountUp(target, ms = 650) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms)
      const e = 1 - (1 - p) ** 3
      setV(a + (target - a) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

/** Profit / loss is never colour alone: arrow + word + sign. */
function Result({ value, light, className }) {
  const t = useT()
  const loss = value < 0
  const Icon = loss ? TrendingDown : TrendingUp
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-extrabold', light ? (loss ? 'bg-white text-rose-700' : 'bg-white text-emerald-700') : (loss ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'), className)}>
      <Icon className="h-4 w-4" strokeWidth={2.6} />
      {loss ? t('Loss') : t('Profit')} <span className="tabular">{loss ? '−' : '+'}{money(Math.abs(value))}</span>
    </span>
  )
}

/** 7-day sales line with an area wash; hover (or touch) a day to read its value. */
function Trend({ points, color }) {
  const [hover, setHover] = useState(null)
  const W = 240
  const H = 64
  const pad = 6
  const max = Math.max(...points.map((p) => p.total), 1)
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(points.length - 1, 1)
  const y = (v) => H - pad - (v / max) * (H - pad * 2)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${H - pad} L${x(0)},${H - pad} Z`
  const h = hover != null ? points[hover] : null
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX ?? e.touches?.[0]?.clientX) - r.left) / r.width
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(px * (points.length - 1)))))
  }
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full touch-pan-y" onMouseMove={onMove} onTouchMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Sales, last 7 days">
        <defs><linearGradient id={`g${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill={`url(#g${color.slice(1)})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad} y2={H - pad} stroke="#6F675D" strokeOpacity=".35" strokeDasharray="2 3" />
            <circle cx={x(hover)} cy={y(h.total)} r="4" fill={color} stroke="#fff" strokeWidth="2" />
          </>
        )}
        {hover == null && <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].total)} r="3.5" fill={color} stroke="#fff" strokeWidth="2" />}
      </svg>
      {h && (
        <div className="pointer-events-none absolute -top-9 rounded-xl bg-ink px-2.5 py-1 text-[11px] font-bold text-white shadow-float" style={{ left: `${(x(hover) / W) * 100}%`, transform: 'translateX(-50%)' }}>
          {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit' })} · <span className="tabular">{money(h.total)}</span>
        </div>
      )}
    </div>
  )
}

function Mini({ label, value }) {
  const t = useT()
  return (
    <div className="rounded-2xl bg-canvas px-2 py-2.5 text-center leading-tight">
      <div className="tabular truncate text-[15px] font-extrabold">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-muted">{t(label)}</div>
    </div>
  )
}

export default function Counters() {
  const t = useT()
  const nav = useNavigate()
  const toast = useToast()
  const { refresh } = useAuth()
  const { counters: list, select } = useCounter()
  const [range, setRange] = useState('today')
  const { data, loading, reload } = useApi('/counters/overview', { params: rangeDates(range) })
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)

  const colorOf = useMemo(() => Object.fromEntries(list.map((c) => [c.id, c.color])), [list])
  const total = data?.total
  const big = useCountUp(total?.sales || 0)
  const rows = data?.counters || []
  const shown = rows.filter((c) => c.is_active)

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      edit.id ? await api.put(`/counters/${edit.id}`, { name: edit.name, address: edit.address || null, is_active: edit.is_active }) : await api.post('/counters', { name: edit.name, address: edit.address || null })
      toast.success(t('Saved'))
      setEdit(null)
      await refresh()
      reload()
    } catch (x) { toast.error(x) } finally { setBusy(false) }
  }
  const open = (c, to) => { select(c.id); nav(to) }

  if (loading && !data) return <Spinner />
  return (
    <>
      <PageHeader title="Counters" sub="Every counter's sales, expenses and profit or loss — side by side" actions={<Button onClick={() => setEdit({ name: '', address: '', is_active: true })}><Plus className="h-4 w-4" /> {t('Add counter')}</Button>} />
      <Chips items={RANGES.map(([k, l]) => [k, t(l)])} value={range} onChange={setRange} />

      {/* ── Hero: all counters together ── */}
      <section className="relative overflow-hidden rounded-[1.75rem] bg-brand p-5 text-white shadow-lift sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-56 w-56 rounded-full bg-accent/25 blur-2xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-bold text-white/75">{t('All counters')} · {t(RANGES.find((r) => r[0] === range)[1])}</div>
            <Result value={total?.profit || 0} light />
          </div>
          <div className="tabular mt-2 text-[40px] font-extrabold leading-none tracking-tight sm:text-6xl">{money(big)}</div>
          <div className="mt-1 text-sm font-medium text-white/70">{t('Total sales, all counters')}</div>

          {/* share of sales: one segment per counter, 2px gaps, names + amounts as direct labels */}
          {total?.sales > 0 && (
            <div className="mt-5">
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                {shown.filter((c) => c.sales > 0).map((c) => <div key={c.id} title={c.name} className="min-w-1.5 first:rounded-l-full last:rounded-r-full" style={{ width: `${(c.sales / total.sales) * 100}%`, background: colorOf[c.id] }} />)}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {shown.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-[13px] font-semibold">
                    <i className="h-2.5 w-2.5 rounded-full ring-2 ring-white/40" style={{ background: colorOf[c.id] }} />
                    <span className="text-white/85">{c.name}</span>
                    <span className="tabular text-white">{money(c.sales)}</span>
                    {total.sales > 0 && <span className="tabular text-white/60">{Math.round((c.sales / total.sales) * 100)}%</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[['Bills', total?.bills ?? 0, Receipt], ['Orders', total?.orders ?? 0, ShoppingBag], ['Open now', total?.open_orders ?? 0, Store], ['Expenses', money(total?.expenses || 0), Wallet]].map(([l, v, I]) => (
              <div key={l} className="rounded-2xl bg-white/12 px-3.5 py-3 ring-1 ring-white/15 backdrop-blur-sm">
                <I className="mb-1.5 h-4 w-4 text-white/70" />
                <div className="tabular text-lg font-extrabold leading-tight">{v}</div>
                <div className="text-[11px] font-semibold text-white/65">{t(l)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── One card per counter ── */}
      <div className="mb-3 mt-7 flex items-end justify-between">
        <h2 className="text-lg font-extrabold tracking-tight">{t('Counter-wise')}</h2>
        <span className="text-xs font-semibold text-muted">{t('{n} counters', { n: shown.length })}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((c) => {
          const color = colorOf[c.id]
          const off = !c.is_active
          return (
            <Card key={c.id} className={cx('relative flex flex-col overflow-hidden !p-0 transition duration-200 hover:-translate-y-0.5 hover:shadow-lift', off && 'opacity-60')}>
              <div className="h-1.5" style={{ background: color }} />
              <div className="flex flex-1 flex-col p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-card" style={{ background: color }}><Store className="h-5 w-5" strokeWidth={2.3} /></span>
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-[17px] font-extrabold tracking-tight">{c.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        <Users className="h-3.5 w-3.5" />{t('{n} staff', { n: c.staff })}<span>·</span><Armchair className="h-3.5 w-3.5" />{t('{n} tables', { n: c.tables })}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {off && <Badge tone="slate">disabled</Badge>}
                    <button onClick={() => setEdit({ ...c })} aria-label={t('Edit counter')} className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-canvas active:scale-90"><Pencil className="h-4 w-4" /></button>
                  </div>
                </div>

                <div className="mt-4 flex items-end justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{t('Sales')}</div>
                    <div className="tabular text-[28px] font-extrabold leading-none tracking-tight">{money(c.sales)}</div>
                  </div>
                  <Result value={c.profit} />
                </div>

                <div className="mt-3"><Trend points={c.trend} color={color} /></div>
                <div className="-mt-1 mb-3 flex justify-between text-[10px] font-semibold text-muted"><span>{t('7 days ago')}</span><span>{t('Today')}</span></div>

                <div className="grid grid-cols-3 gap-2">
                  <Mini label="Bills" value={c.bills} />
                  <Mini label="Open now" value={c.open_orders} />
                  <Mini label="Expenses" value={money(c.expenses)} />
                </div>

                {Object.keys(c.payments || {}).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(c.payments).map(([m, v]) => <span key={m} className="inline-flex items-center gap-1 rounded-full bg-canvas px-2.5 py-1 text-[11px] font-bold text-slate-600"><Banknote className="h-3 w-3" /><span className="uppercase">{m}</span> <span className="tabular">{money(v)}</span></span>)}
                  </div>
                )}

                <div className="mt-4 flex gap-2 pt-1">
                  <Button size="sm" variant="soft" className="flex-1" disabled={off} onClick={() => open(c, '/app/orders')}>{t('Orders')} <ArrowRight className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="secondary" className="flex-1" disabled={off} onClick={() => open(c, '/app/tables')}>{t('Tables')}</Button>
                </div>
              </div>
            </Card>
          )
        })}

        <button onClick={() => setEdit({ name: '', address: '', is_active: true })} className="flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-[1.25rem] border-2 border-dashed border-line bg-white/40 text-muted transition hover:border-brand/40 hover:bg-white hover:text-brand active:scale-[.99]">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-card"><Plus className="h-6 w-6" /></span>
          <span className="text-sm font-bold">{t('Add a counter')}</span>
        </button>
      </div>

      {/* ── Summary table with the combined total ── */}
      <div className="mt-8 overflow-hidden rounded-[1.25rem] border border-line/70 bg-white shadow-card">
        <div className="flex items-center justify-between px-5 pt-4"><h2 className="text-lg font-extrabold tracking-tight">{t('Profit & loss by counter')}</h2></div>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-muted">
              <tr>{['Counter', 'Sales', 'Tax', 'Expenses', 'Profit / Loss'].map((h, i) => <th key={h} className={cx('px-5 py-3 font-bold', i > 0 && 'text-right')}>{t(h)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-3.5 font-bold"><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf[c.id] }} />{c.name}</span></td>
                  <td className="tabular px-5 py-3.5 text-right">{money(c.sales)}</td>
                  <td className="tabular px-5 py-3.5 text-right text-muted">{money(c.tax)}</td>
                  <td className="tabular px-5 py-3.5 text-right">{money(c.expenses)}</td>
                  <td className={cx('tabular px-5 py-3.5 text-right font-extrabold', c.profit < 0 ? 'text-rose-700' : 'text-emerald-700')}>{c.profit < 0 ? '▼ −' : '▲ '}{money(Math.abs(c.profit))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-brand-soft/60 font-extrabold">
                <td className="px-5 py-4">{t('Total')}</td>
                <td className="tabular px-5 py-4 text-right">{money(total?.sales)}</td>
                <td className="tabular px-5 py-4 text-right">{money(total?.tax)}</td>
                <td className="tabular px-5 py-4 text-right">{money(total?.expenses)}</td>
                <td className={cx('tabular px-5 py-4 text-right', (total?.profit || 0) < 0 ? 'text-rose-700' : 'text-emerald-700')}>{(total?.profit || 0) < 0 ? '▼ −' : '▲ '}{money(Math.abs(total?.profit || 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-5 pb-4 pt-2 text-xs text-muted">{t('Profit / Loss = sales − tax − expenses of that counter.')}</p>
      </div>

      <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 !bg-brand-soft/70">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-brand shadow-card"><UserPlus className="h-5 w-5" /></span>
          <div className="leading-tight"><div className="font-extrabold">{t('Counter logins')}</div><div className="text-sm text-muted">{t('Give each counter its own login so it only sees its own tables, bills and books.')}</div></div></div>
        <Button variant="secondary" onClick={() => nav('/app/staff')}>{t('Manage staff')} <ArrowRight className="h-4 w-4" /></Button>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit counter' : 'Add a counter'}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Input label="Counter name" required maxLength={60} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Garden counter" />
            <Input label="Address / note (optional)" value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            {edit.id && <Switch label="Counter is active" checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} hint={edit.is_active ? 'Its staff can sign in and take orders.' : 'Its staff cannot sign in. All its past sales stay in your reports.'} />}
            {!edit.id && <p className="text-xs text-muted">{t('After adding it, create a login for this counter under Staff.')}</p>}
            <Button type="submit" loading={busy} className="w-full">Save</Button>
          </form>
        )}
      </Modal>
    </>
  )
}
