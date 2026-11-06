import { Eye, EyeOff, Loader2, X } from 'lucide-react'
import { Children, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'

// Plain-string content passed to the shared components is translated here, so pages get i18n for free.
const tx = (t, x) => {
  if (typeof x !== 'string') return x
  const k = x.trim()
  return k ? x.replace(k, t(k)) : x
}
const txs = (t, c) => Children.map(c, (n) => tx(t, n))

export const cx = (...a) => a.filter(Boolean).join(' ')

/* ───────────────────────── Buttons ───────────────────────── */
export function Button({ variant = 'primary', size = 'md', loading, className, children, ...p }) {
  const t = useT()
  const v = {
    primary: 'bg-brand text-white shadow-[0_6px_16px_-6px_rgb(23_100_95/.55)] hover:bg-brand-dark',
    // Coral is reserved for the key call-to-action on a screen (new order, place order, collect payment…)
    accent: 'bg-accent text-white shadow-[0_8px_18px_-8px_rgb(255_104_69/.75)] hover:bg-accent-dark',
    secondary: 'bg-white text-ink ring-1 ring-line shadow-sm hover:bg-slate-50',
    danger: 'bg-rose-600 text-white shadow-[0_6px_16px_-6px_rgb(225_29_72/.5)] hover:bg-rose-700',
    dark: 'bg-ink text-white shadow-lg hover:bg-slate-800',
    ghost: 'text-slate-600 hover:bg-slate-100',
    soft: 'bg-brand-soft text-brand hover:bg-emerald-100',
  }[variant]
  // 44px minimum touch target on phones; compact on larger screens.
  const s = { sm: 'min-h-11 px-4 text-[13px] lg:min-h-9 lg:px-3.5 lg:text-xs', md: 'min-h-11 px-5 text-sm', lg: 'min-h-14 px-6 text-base' }[size]
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx('inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold transition duration-150 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50', v, s, className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {txs(t, children)}
    </button>
  )
}

/* ───────────────────────── Form fields ───────────────────────── */
export function Field({ label, hint, error, children }) {
  const t = useT()
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">{tx(t, label)}</span>}
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-muted">{tx(t, hint)}</span>}
      {error && <span role="alert" className="mt-1.5 block text-xs font-medium text-rose-600">{tx(t, error)}</span>}
    </label>
  )
}

// 16px on mobile prevents iOS zoom-on-focus.
const inputBase =
  'min-h-12 w-full rounded-2xl border bg-white px-4 py-3 text-[16px] text-ink outline-none transition placeholder:text-slate-400 focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:min-h-11 sm:text-sm'
const inputState = (error) => (error ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100' : 'border-line hover:border-slate-300 focus:border-brand focus:ring-brand/10')

/** Text input. `icon` adds a leading icon; password inputs get a show/hide toggle automatically. */
export const Input = ({ label, hint, error, className, icon: Icon, type, ...p }) => {
  const t = useT()
  const [show, setShow] = useState(false)
  const isPw = type === 'password'
  return (
    <Field label={label} hint={hint} error={error}>
      <span className="relative block">
        {Icon && <Icon className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />}
        <input {...p} placeholder={tx(t, p.placeholder)} type={isPw && show ? 'text' : type} className={cx(inputBase, inputState(error), Icon && 'pl-11', isPw && 'pr-12', className)} />
        {isPw && (
          <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)} aria-label={show ? t('Hide password') : t('Show password')} className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-slate-400 hover:text-slate-600">
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        )}
      </span>
    </Field>
  )
}

/** Accessible on/off switch with a 44px touch target. */
export function Switch({ checked, onChange, label, hint, disabled }) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-white px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-bold">{tx(t, label)}</div>
        {hint && <div className="mt-0.5 text-xs leading-snug text-muted">{tx(t, hint)}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={tx(t, label)} disabled={disabled} onClick={() => onChange(!checked)} className="flex h-11 w-16 shrink-0 items-center justify-center disabled:opacity-50">
        <span className={cx('relative h-8 w-14 rounded-full transition-colors duration-200', checked ? 'bg-brand' : 'bg-slate-300')}>
          <span className={cx('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all duration-200', checked ? 'left-7' : 'left-1')} />
        </span>
      </button>
    </div>
  )
}

export const Select = ({ label, hint, error, children, className, ...p }) => (
  <Field label={label} hint={hint} error={error}>
    <select {...p} className={cx(inputBase, inputState(error), className)}>
      {children}
    </select>
  </Field>
)

export const Textarea = ({ label, hint, error, ...p }) => {
  const t = useT()
  return (
  <Field label={label} hint={hint} error={error}>
    <textarea rows={3} {...p} placeholder={tx(t, p.placeholder)} className={cx(inputBase, inputState(error), 'resize-none')} />
  </Field>
  )
}

/* ───────────────────────── Surfaces ───────────────────────── */
export const Card = ({ className, children, interactive, ...p }) => (
  <div {...p} className={cx('rounded-[1.25rem] border border-line/70 bg-surface p-4 shadow-card sm:p-5', interactive && 'cursor-pointer transition duration-200 hover:-translate-y-0.5 hover:shadow-lift active:scale-[.985]', className)}>
    {children}
  </div>
)

export const SectionTitle = ({ title, action }) => {
  const t = useT()
  return (
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-[17px] font-extrabold tracking-tight">{tx(t, title)}</h2>
    {action}
  </div>
  )
}

export function Avatar({ name = '', size = 'md', src, className }) {
  const dim = { sm: 'h-9 w-9 text-sm', md: 'h-11 w-11 text-base', lg: 'h-14 w-14 text-xl' }[size]
  return src
    ? <img src={src} alt="" className={cx('shrink-0 rounded-full object-cover ring-2 ring-white/40', dim, className)} />
    : <span className={cx('grid shrink-0 place-items-center rounded-full bg-white/20 font-extrabold uppercase text-white ring-2 ring-white/30', dim, className)}>{name.trim()[0]}</span>
}

export function Stat({ label, value, icon: Icon, tone = 'brand', sub }) {
  const t = useT()
  const tones = {
    brand: 'bg-brand-soft text-brand',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    sky: 'bg-sky-50 text-sky-600',
  }
  return (
    <Card className="flex flex-col gap-3 !p-4">
      {Icon && (
        <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-2xl', tones[tone])}>
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-muted">{tx(t, label)}</div>
        <div className="tabular truncate text-[22px] font-extrabold leading-tight tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted">{tx(t, sub)}</div>}
      </div>
    </Card>
  )
}

export function Badge({ tone = 'slate', children, dot }) {
  const tr = useT()
  const t = {
    slate: ['bg-slate-100 text-slate-600', 'bg-slate-400'],
    green: ['bg-emerald-50 text-emerald-700', 'bg-emerald-500'],
    red: ['bg-rose-50 text-rose-700', 'bg-rose-500'],
    amber: ['bg-amber-50 text-amber-700', 'bg-amber-500'],
    blue: ['bg-sky-50 text-sky-700', 'bg-sky-500'],
    violet: ['bg-violet-50 text-violet-700', 'bg-violet-500'],
  }[tone]
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold capitalize', t[0])}>
      {dot !== false && <i className={cx('h-1.5 w-1.5 rounded-full', t[1])} />}
      {txs(tr, children)}
    </span>
  )
}

export const statusTone = (s) =>
  ({ active: 'green', trial: 'blue', paid: 'green', available: 'green', ready: 'blue', served: 'green', accepted: 'blue', pending: 'amber', preparing: 'amber', unpaid: 'amber', inactive: 'slate', suspended: 'red', cancelled: 'red', void: 'red', expired: 'red', open: 'amber', resolved: 'green', closed: 'slate' })[s] || 'slate'

/* ───────────────────────── Overlays ───────────────────────── */
/** Bottom sheet on phones, centred dialog on larger screens. */
/** `wide`: roomy dialog; `full`: fills the screen on tablets/desktops (bottom sheet on phones as usual). */
export function Modal({ open, onClose, title, children, wide, full }) {
  const t = useT()
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div role="dialog" aria-modal="true" className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cx('animate-sheet mb-[max(env(safe-area-inset-bottom),0px)] w-full overflow-y-auto overscroll-contain rounded-[1.25rem] bg-white px-4 pb-7 pt-3 shadow-float sm:px-6 sm:animate-pop sm:pt-6', full ? 'max-h-[94dvh] sm:h-[94dvh] sm:max-w-[min(96vw,1280px)]' : cx('max-h-[88dvh]', wide ? 'sm:max-w-2xl' : 'sm:max-w-md'))}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-line pb-4">
          <h3 className="text-xl font-extrabold tracking-tight">{tx(t, title)}</h3>
          <button onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95" aria-label={t('Close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-1 [&_form]:space-y-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ───────────────────────── Loading / empty / error ───────────────────────── */
export const Skeleton = ({ className, ...p }) => <div {...p} className={cx('skeleton rounded-xl', className)} />

/** Full-page loading placeholder: shimmering skeletons shaped like a typical screen. */
export const PageSkeleton = () => {
  const t = useT()
  return (
  <div className="animate-fade space-y-5" aria-busy="true" aria-label={t('Loading')}>
    <div className="space-y-2"><Skeleton className="h-8 w-44" /><Skeleton className="h-4 w-64 max-w-full" /></div>
    <div className="flex gap-2 overflow-hidden">{[80, 96, 72, 88].map((w, i) => <Skeleton key={i} className="h-11 rounded-full" style={{ width: w }} />)}</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-3 rounded-[1.25rem] border border-line/70 bg-white p-4 shadow-card"><Skeleton className="h-10 w-10 rounded-2xl" /><Skeleton className="h-3 w-20" /><Skeleton className="h-6 w-28" /></div>
      ))}
    </div>
    <Skeleton className="h-48 w-full rounded-[1.25rem]" />
  </div>
  )
}
export const Spinner = PageSkeleton

/** Lighter placeholder for lists that load inside an already-rendered page. */
export const ListSkeleton = ({ rows = 3 }) => {
  const t = useT()
  return (
  <div className="animate-fade space-y-3" aria-busy="true" aria-label={t('Loading')}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 rounded-[1.25rem] border border-line/70 bg-white p-4 shadow-card">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-2.5"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div>
        <Skeleton className="h-8 w-16 rounded-full" />
      </div>
    ))}
  </div>
  )
}

export const Empty = ({ icon: Icon, title, hint, action }) => {
  const t = useT()
  return (
  <div className="animate-pop grid place-items-center rounded-[1.25rem] border border-dashed border-line bg-white/70 px-6 py-14 text-center">
    {Icon && (
      <div className="relative mb-4 grid h-20 w-20 place-items-center">
        <span className="absolute inset-0 rounded-full bg-brand-soft" />
        <span className="absolute inset-2.5 rounded-full bg-white shadow-card" />
        <Icon className="relative h-8 w-8 text-brand" strokeWidth={2} />
      </div>
    )}
    <div className="text-base font-extrabold">{tx(t, title)}</div>
    {hint && <div className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{tx(t, hint)}</div>}
    {action && <div className="mt-5">{action}</div>}
  </div>
  )
}

export const PageHeader = ({ title, sub, actions }) => {
  const t = useT()
  return (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-[26px] font-extrabold leading-tight tracking-tight sm:text-3xl">{tx(t, title)}</h1>
      {sub && <p className="mt-0.5 text-sm text-muted">{tx(t, sub)}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
  )
}

export const ErrorNote = ({ children }) => {
  const t = useT()
  return children ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{tx(t, children)}</div> : null
}

/* ───────────────────────── Navigation helpers ───────────────────────── */
/** Pill filter row — horizontally scrollable on phones. */
export function Chips({ items, value, onChange }) {
  const t = useT()
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cx('min-h-11 shrink-0 whitespace-nowrap rounded-full px-5 text-sm font-semibold transition duration-200 active:scale-95', value === k ? 'bg-brand text-white shadow-[0_6px_14px_-6px_rgb(23_100_95/.55)]' : 'bg-white text-slate-600 shadow-sm ring-1 ring-line hover:ring-slate-300')}
        >
          {tx(t, label)}
        </button>
      ))}
    </div>
  )
}

/** Table on desktop, stacked cards on phones (labels come from column headers). */
export function Table({ columns, rows, empty = 'Nothing here yet', rowKey = 'id' }) {
  const t = useT()
  if (!rows?.length) return <Empty title={empty} />
  const actions = columns.filter((c) => !c.header)
  const fields = columns.filter((c) => c.header)
  return (
    <>
      <div className="hidden overflow-x-auto rounded-[1.25rem] border border-line/70 bg-white shadow-card md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-muted">
            <tr>{columns.map((c, i) => <th key={c.header || i} className={cx('px-5 py-3.5 font-bold', c.className)}>{tx(t, c.header)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={r[rowKey] ?? i} className="transition hover:bg-brand-soft/50">
                {columns.map((c, j) => <td key={c.header || j} className={cx('px-5 py-3.5', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((r, i) => (
          <div key={r[rowKey] ?? i} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }} className="animate-pop rounded-[1.25rem] border border-line/70 bg-white p-4 shadow-card">
            {fields.map((c, idx) => (
              <div key={c.header} className={cx('flex items-center justify-between gap-3 py-1.5 text-sm', idx === 0 && 'pb-3 text-base font-bold')}>
                {idx !== 0 && <span className="text-xs font-medium text-muted">{tx(t, c.header)}</span>}
                <span className={cx('min-w-0', idx !== 0 && 'text-right')}>{c.render ? c.render(r) : r[c.key]}</span>
              </div>
            ))}
            {(() => {
              const acts = actions.map((c) => c.render(r)).filter(Boolean)
              return acts.length > 0 && <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-line pt-3">{acts.map((a, j) => <div key={j}>{a}</div>)}</div>
            })()}
          </div>
        ))}
      </div>
    </>
  )
}
