import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Download, MoreHorizontal, Plus, QrCode, RefreshCw, Trash2, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useT } from '../../i18n'
import { isParcel, tableLabel, tableText } from '../../lib/format'
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

// ── Sections (Garden, AC hall ...) and table-name prefixes (G1, AC2) ──
const PRESET_SECTIONS = ['Garden', 'AC hall', 'Family floor'] // saved in English (a fast-text slip can only print English letters)
const secKey = (s) => String(s || '').trim().toLowerCase() // "Garden", "garden " and "GARDEN" are one section
const prefixOf = (name) => (String(name).match(/^([A-Za-z]+)\d/)?.[1] || '').toUpperCase() // "G1" -> "G", "12" -> ""
/** The name the server will save for prefix + number (the same rule as the API): "T" / no prefix keeps the bare number. */
const nameWith = (prefix, number) => {
  const n = String(number || '').trim()
  const p = String(prefix || '').trim().toUpperCase()
  if (!n || !p || p === 'T') return n
  return n.toUpperCase().startsWith(p) ? p + n.slice(p.length) : p + n
}
const RESERVED = ['P', 'PARCEL'] // a table must never look like a parcel
/** The prefix a section's existing tables use (G for Garden ...); T when it has none yet. */
const sectionPrefix = (tables, section) => {
  const mine = (tables || []).filter((t) => !isParcel(t.number) && secKey(t.section) === secKey(section) && secKey(section)).sort((a, b) => a.id - b.id)
  return mine.length ? prefixOf(mine[0].number) || 'T' : 'T'
}

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
  const [adding, setAdding] = useState(null) // null | 'table' | 'parcel'
  const [sel, setSel] = useState(null)
  const [qr, setQr] = useState(null)
  const manage = can('tables.manage')
  useTick()

  const counts = (data || []).reduce((a, t) => ({ ...a, [t.status]: (a[t.status] || 0) + 1 }), {})
  const rows = (data || []).filter((t) => filter === 'all' || t.status === filter)
  // Tables are grouped by section: no-section first, then each section in the order its first table was created, parcels last.
  // Nobody has a section yet: no headings at all (one grid, tables then parcels), exactly as before.
  const sectioned = (data || []).some((t) => !isParcel(t.number) && secKey(t.section))
  const groups = (() => {
    const tablesOnly = rows.filter((x) => !isParcel(x.number))
    const parcels = rows.filter((x) => isParcel(x.number))
    if (!sectioned) return [{ key: 'all', title: null, items: [...tablesOnly, ...parcels] }]
    const first = new Map() // section key -> { name, id } of its first-created table (over ALL tables, so the order stays put when a status filter is on)
    ;(data || []).filter((x) => !isParcel(x.number) && secKey(x.section)).sort((a, b) => a.id - b.id).forEach((x) => { if (!first.has(secKey(x.section))) first.set(secKey(x.section), { name: String(x.section).trim(), id: x.id }) })
    const out = [{ key: 'none', title: tx('No section'), items: tablesOnly.filter((x) => !secKey(x.section)) }]
    ;[...first.entries()].sort((a, b) => a[1].id - b[1].id).forEach(([k, v]) => out.push({ key: `s:${k}`, title: v.name, items: tablesOnly.filter((x) => secKey(x.section) === k) }))
    out.push({ key: 'parcel', title: tx('Parcel'), items: parcels })
    return out.filter((g) => g.items.length)
  })()
  // Tap a table: straight to taking its order (adds to the running order if it has one). Staff who cannot take orders get the options sheet.
  const tap = (t) => (can('orders.create') ? nav(`/app/order/new?table=${t.id}`) : setSel(t))

  const setStatus = async (t, status) => {
    try { await api.patch(`/tables/${t.id}/status`, { status }); toast.success(tx('Table {n} → {status}', { n: t.number, status: stLabel(status) })); setSel(null); reload() } catch (e) { toast.error(e) }
  }
  const remove = async (t) => {
    if (!(await ask({ title: tx('Delete table {n}?', { n: tableLabel(t.number) }), message: tx('The table and its QR code will be removed. Tables with open orders cannot be deleted.'), confirmText: tx('Delete table') }))) return
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

  const card = (t, i) => {
    const l = LOOK[t.status]
    return (
      <div key={t.id} role="button" tabIndex={0} onClick={() => tap(t)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(t) } }} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} className={`animate-pop relative cursor-pointer select-none overflow-hidden rounded-[1.25rem] border-2 p-3.5 text-left shadow-sm transition active:scale-[.96] ${l.card} ${l.text}`}>
        <div className="flex min-h-8 items-center justify-between gap-1 text-[11px] font-semibold">
          <span className="flex min-w-0 items-center gap-1 whitespace-nowrap opacity-70" title={tx('{n} seater', { n: t.capacity })} aria-label={tx('{n} seater', { n: t.capacity })}><Users className="h-3.5 w-3.5 shrink-0" />{isParcel(t.number) ? tx('Parcel') : t.capacity}</span>
          <span className="flex shrink-0 items-center gap-1">
            {t.open_orders > 0 && <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] opacity-90">{tx(t.open_orders > 1 ? '{n} orders' : '{n} order', { n: t.open_orders })}</span>}
            {/* small button: status, section, QR code, delete */}
            <button type="button" aria-label={tx('Table options')} title={tx('Table options')} onClick={(e) => { e.stopPropagation(); setSel(t) }} onKeyDown={(e) => e.stopPropagation()} className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-slate-700 shadow-sm transition hover:bg-white active:scale-90"><MoreHorizontal className="h-4 w-4" /></button>
          </span>
        </div>
        <div className="mt-3 text-4xl font-extrabold tracking-tight">{tableLabel(t.number)}</div>
        <div className="mb-3 min-h-4 truncate text-[11px] font-bold opacity-70">{t.section || ''}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${l.pill}`}>{stLabel(t.status)}</span>
          {t.open_since && <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold"><Clock className="h-3 w-3" />{elapsed(t.open_since)}</span>}
        </div>
      </div>
    )
  }

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title={tx('Tables')} actions={manage && <div className="flex gap-2"><Button size="sm" onClick={() => setAdding('table')}><Plus className="h-4 w-4" /> {tx('Add')}</Button>{company?.parcel_enabled && <Button size="sm" variant="secondary" onClick={() => setAdding('parcel')}><Plus className="h-4 w-4" /> {tx('Parcel')}</Button>}</div>} />

      <Chips value={filter} onChange={setFilter} items={[['all', tx('All ({n})', { n: data.length })], ...STATUSES.map((s) => [s, `${tx(cap(s))}${counts[s] ? ` (${counts[s]})` : ''}`])]} />

      {!rows.length ? <Empty icon={Users} title={tx('No tables here')} hint={manage ? tx('Add your first table to start taking orders.') : tx('Ask the owner to add tables.')} /> : (
        <div className="space-y-1">
          {(() => {
            let n = 0
            return groups.map((g) => (
              <section key={g.key}>
                {g.title && (
                  <h3 className="mb-2 mt-4 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-muted">
                    <span className="truncate">{g.title}</span><span className="h-px flex-1 bg-line" /><span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-line">{g.items.length}</span>
                  </h3>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">{g.items.map((t) => card(t, n++))}</div>
              </section>
            ))
          })()}
        </div>
      )}

      <Modal open={!!sel} onClose={() => setSel(null)} title={tableText(tx, sel?.number ?? '')}>
        {sel && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm text-muted"><span className={`h-2.5 w-2.5 rounded-full ${LOOK[sel.status].dot}`} /><span className="capitalize">{tx('{status} · {n} seats', { status: stLabel(sel.status), n: sel.capacity })}</span></div>
            {can('orders.create') && <Button variant="accent" className="w-full" size="lg" onClick={() => nav(`/app/order/new?table=${sel.id}`)}>{sel.open_orders ? tx('Add items to order') : tx('Take order')}</Button>}
            {sel.open_orders > 0 && <Button className="w-full" variant="secondary" onClick={() => nav('/app/orders')}>{tx('View open orders')}</Button>}
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600">{tx('Change status')}</div>
              <div className="flex flex-wrap gap-2">{STATUSES.map((s) => <button key={s} onClick={() => setStatus(sel, s)} className={`rounded-full px-3.5 py-2 text-xs font-semibold capitalize ring-1 transition ${sel.status === s ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{stLabel(s) === 'Free' ? tx('Available') : stLabel(s)}</button>)}</div>
            </div>
            {manage && (isParcel(sel.number)
              ? <SectionField key={sel.id} table={sel} onSaved={(section) => { setSel({ ...sel, section }); reload() }} />
              : <TableEditor key={sel.id} table={sel} tables={data} onSaved={(t) => { setSel({ ...sel, ...t }); reload() }} />)}
            {manage && (
              <div className="flex gap-2">
                {!isParcel(sel.number) && hasFeature('qr') && company?.qr_enabled !== false && <Button variant="secondary" className="flex-1" onClick={() => { const t = sel; setSel(null); showQr(t) }}><QrCode className="h-4 w-4" /> {tx('QR code')}</Button>}
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

      <AddTable open={!!adding} kind={adding} tables={data} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload() }} />
    </>
  )
}

/** Where this table is (Garden, AC hall ...): shown with the table number on orders and order alerts. */
function SectionField({ table, onSaved }) {
  const tx = useT()
  const toast = useToast()
  const [v, setV] = useState(table.section || '')
  const save = async () => {
    try { await api.put(`/tables/${table.id}`, { section: v || null }); toast.success(tx('Saved')); onSaved(v || null) } catch (e) { toast.error(e) }
  }
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1"><Input label={tx('Section / area (optional)')} placeholder={tx('e.g. Garden, AC hall, First floor')} value={v} onChange={(e) => setV(e.target.value)} /></div>
      <Button variant="secondary" disabled={(table.section || '') === v} onClick={save}>{tx('Save')}</Button>
    </div>
  )
}

/**
 * Section picker: None | Garden | AC hall | Family floor | any custom section already in use | + Custom (a text box).
 * Real <select> + <input>, no Chips (Chips has no type="button" and would submit the form).
 */
function SectionPicker({ value, onChange, tables, label }) {
  const tx = useT()
  const options = useMemo(() => {
    const out = [...PRESET_SECTIONS]
    ;(tables || []).filter((t) => !isParcel(t.number)).forEach((t) => { const n = String(t.section || '').trim(); if (n && !out.some((o) => secKey(o) === secKey(n))) out.push(n) })
    return out
  }, [tables])
  const known = !value || options.some((o) => secKey(o) === secKey(value))
  const [custom, setCustom] = useState(!known)
  const shown = custom ? '__custom' : options.find((o) => secKey(o) === secKey(value)) || ''
  return (
    <div className="space-y-2">
      <Select label={label || tx('Section / area (optional)')} value={shown} onChange={(e) => { const v = e.target.value; if (v === '__custom') { setCustom(true); onChange('') } else { setCustom(false); onChange(v) } }}>
        <option value="">{tx('None')}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__custom">+ {tx('Custom')}</option>
      </Select>
      {custom && <Input aria-label={tx('Section name')} placeholder={tx('Section name')} maxLength={60} autoFocus value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  )
}

/** Prefix + number with the live "Shows as G1" line. */
function NameFields({ prefix, number, onPrefix, onNumber, numberLabel }) {
  const tx = useT()
  const bad = RESERVED.includes(prefix.toUpperCase())
  const name = nameWith(prefix, number)
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <div className="w-24 shrink-0"><Input label={tx('Prefix')} maxLength={6} autoCapitalize="characters" autoComplete="off" value={prefix} onChange={(e) => onPrefix(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())} /></div>
        <div className="min-w-0 flex-1"><Input label={numberLabel} required value={number} onChange={(e) => onNumber(e.target.value)} /></div>
      </div>
      {bad ? <p className="text-xs font-semibold text-rose-600">{tx('P and PARCEL are reserved for parcels.')}</p>
        : name && <p className="text-xs text-muted">{tx('Shows as {n}', { n: tableLabel(name) })}</p>}
    </div>
  )
}

/** Table options sheet (tables only): section, prefix and number, saved together with PUT /tables/{id}. */
function TableEditor({ table, tables, onSaved }) {
  const tx = useT()
  const toast = useToast()
  const m = String(table.number).match(/^([A-Za-z]+)(\d.*)$/)
  const [section, setSection] = useState(table.section || '')
  const [prefix, setPrefix] = useState(m ? m[1].toUpperCase() : 'T')
  const [number, setNumber] = useState(m ? m[2] : String(table.number))
  const name = nameWith(prefix, number)
  const dirty = name !== String(table.number) || secKey(section) !== secKey(table.section) || section.trim() !== String(table.section || '').trim()
  const bad = RESERVED.includes(prefix.toUpperCase()) || !name
  const save = async () => {
    try {
      const r = await api.put(`/tables/${table.id}`, { section: section.trim() || null, prefix: prefix || 'T', number })
      toast.success(tx('Saved')); onSaved(r.data)
    } catch (e) { toast.error(e) }
  }
  return (
    <div className="space-y-3">
      <SectionPicker value={section} onChange={setSection} tables={tables} />
      <NameFields prefix={prefix} number={number} onPrefix={setPrefix} onNumber={setNumber} numberLabel={tx('Table number')} />
      <Button type="button" variant="secondary" className="w-full" disabled={!dirty || bad} onClick={save}>{tx('Save')}</Button>
    </div>
  )
}

function AddTable({ open, kind, tables, onClose, onDone }) {
  const tx = useT()
  const toast = useToast()
  const { data: staff } = useApi('/staff', { skip: !open })
  const [f, setF] = useState({ number: '', prefix: 'T', section: '', capacity: 4, waiter_id: '' })
  const submit = async (e) => {
    e.preventDefault()
    const isP = kind === 'parcel'
    if (!isP && RESERVED.includes(f.prefix.toUpperCase())) return
    try {
      const { prefix, ...rest } = f
      await api.post('/tables', { ...rest, ...(isP ? {} : { prefix: prefix || 'T' }), kind: isP ? 'parcel' : 'table', capacity: isP ? 1 : f.capacity, section: f.section.trim() || null, waiter_id: f.waiter_id || null })
      toast.success(tx(isP ? 'Parcel added' : 'Table added')); setF({ number: '', prefix: f.prefix, section: f.section, capacity: 4, waiter_id: '' }); onDone()
    } catch (x) { toast.error(x) }
  }
  return (
    <Modal open={open} onClose={onClose} title={tx(kind === 'parcel' ? 'Add parcel' : 'Add table')}>
      <form onSubmit={submit} className="space-y-3">
        {kind === 'parcel'
          ? <Input label={tx('Parcel number (e.g. 1 for Parcel 1)')} required inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
          : (
            <>
              {/* picking a section fills in the prefix its tables already use (Garden -> G) */}
              <SectionPicker key={String(open)} value={f.section} tables={tables} onChange={(section) => setF((x) => ({ ...x, section, prefix: section.trim() ? sectionPrefix(tables, section) : x.prefix }))} />
              <NameFields prefix={f.prefix} number={f.number} onPrefix={(prefix) => setF({ ...f, prefix })} onNumber={(number) => setF({ ...f, number })} numberLabel={tx('Table number')} />
            </>
          )}
        {kind !== 'parcel' && <Input label={tx('Seats')} type="number" min="1" required value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />}
        {kind !== 'parcel' && <Select label={tx('Assigned waiter')} value={f.waiter_id} onChange={(e) => setF({ ...f, waiter_id: e.target.value })}>
          <option value="">{tx('Unassigned')}</option>
          {staff?.filter((s) => s.role === 'waiter' || s.role === 'captain').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>}
        <Button type="submit" size="lg" className="w-full">{tx(kind === 'parcel' ? 'Add parcel' : 'Add table')}</Button>
      </form>
    </Modal>
  )
}
