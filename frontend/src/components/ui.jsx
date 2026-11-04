import { Loader2, X } from 'lucide-react'
import { useEffect } from 'react'

const cx = (...a) => a.filter(Boolean).join(' ')

export function Button({ variant = 'primary', size = 'md', loading, className, children, ...p }) {
  const v = {
    primary: 'bg-brand-gradient text-white shadow-md shadow-brand/25 hover:brightness-105',
    secondary: 'bg-white text-ink border border-line shadow-sm hover:bg-slate-50',
    danger: 'bg-rose-600 text-white shadow-md shadow-rose-600/20 hover:bg-rose-700',
    ghost: 'text-muted hover:bg-slate-100',
    soft: 'bg-brand-soft text-brand hover:brightness-95',
  }[variant]
  const s = { sm: 'min-h-9 px-3.5 text-xs', md: 'min-h-11 px-4 text-sm', lg: 'min-h-13 px-5 text-base' }[size]
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-50', v, s, className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  )
}

// 16px on mobile prevents iOS zoom-on-focus.
const inputCls =
  'min-h-12 w-full rounded-2xl border border-line bg-white px-4 py-3 text-[16px] outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm'

export const Input = ({ label, hint, error, className, ...p }) => (
  <Field label={label} hint={hint} error={error}>
    <input {...p} className={cx(inputCls, className)} />
  </Field>
)

export const Select = ({ label, hint, error, children, className, ...p }) => (
  <Field label={label} hint={hint} error={error}>
    <select {...p} className={cx(inputCls, className)}>
      {children}
    </select>
  </Field>
)

export const Textarea = ({ label, ...p }) => (
  <Field label={label}>
    <textarea rows={3} {...p} className={inputCls} />
  </Field>
)

export const Card = ({ className, children, ...p }) => (
  <div {...p} className={cx('rounded-3xl border border-line/70 bg-surface p-4 shadow-card', className)}>
    {children}
  </div>
)

export function Stat({ label, value, icon: Icon, tone = 'brand', sub }) {
  const tones = {
    brand: 'bg-brand-soft text-brand',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    sky: 'bg-sky-50 text-sky-600',
  }
  return (
    <Card className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
      {Icon && (
        <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-2xl sm:h-11 sm:w-11', tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
        <div className="truncate text-xl font-bold tracking-tight">{value}</div>
        {sub && <div className="text-[11px] text-muted">{sub}</div>}
      </div>
    </Card>
  )
}

export function Badge({ tone = 'slate', children }) {
  const t = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-sky-50 text-sky-700',
    violet: 'bg-violet-50 text-violet-700',
  }[tone]
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize', t)}>{children}</span>
}

export const statusTone = (s) =>
  ({ active: 'green', trial: 'blue', paid: 'green', available: 'green', ready: 'blue', served: 'green', accepted: 'blue', pending: 'amber', preparing: 'amber', unpaid: 'amber', inactive: 'slate', suspended: 'red', cancelled: 'red', void: 'red', expired: 'red', open: 'amber', resolved: 'green', closed: 'slate' })[s] || 'slate'

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Modal({ open, onClose, title, children, wide }) {
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
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cx('animate-sheet safe-bottom max-h-[92vh] w-full overflow-y-auto rounded-t-[2rem] bg-white px-5 pb-6 pt-3 shadow-float sm:animate-pop sm:rounded-3xl sm:pt-5', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold tracking-tight">{title}</h3>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const Spinner = () => (
  <div className="grid place-items-center py-20 text-brand">
    <Loader2 className="h-7 w-7 animate-spin" />
  </div>
)

export const Empty = ({ icon: Icon, title, hint, action }) => (
  <div className="grid place-items-center rounded-3xl border-2 border-dashed border-line bg-white/70 px-6 py-14 text-center">
    {Icon && <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon className="h-7 w-7" /></div>}
    <div className="font-semibold">{title}</div>
    {hint && <div className="mt-1 max-w-sm text-sm text-muted">{hint}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)

export const PageHeader = ({ title, sub, actions }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
)

export const ErrorNote = ({ children }) =>
  children ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{children}</div> : null

/** Pill filter row — horizontally scrollable on phones. */
export function Chips({ items, value, onChange }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={cx('shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition', value === k ? 'bg-brand-gradient text-white shadow-md shadow-brand/25' : 'bg-white text-slate-600 shadow-sm ring-1 ring-line')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Table on desktop, stacked cards on phones (labels come from column headers). */
export function Table({ columns, rows, empty = 'Nothing here yet', rowKey = 'id' }) {
  if (!rows?.length) return <Empty title={empty} />
  const actions = columns.filter((c) => !c.header)
  const fields = columns.filter((c) => c.header)
  return (
    <>
      <div className="hidden overflow-x-auto rounded-3xl border border-line/70 bg-white shadow-card md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-muted">
            <tr>{columns.map((c, i) => <th key={c.header || i} className={cx('px-4 py-3 font-semibold', c.className)}>{c.header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={r[rowKey] ?? i} className="hover:bg-slate-50/60">
                {columns.map((c, j) => <td key={c.header || j} className={cx('px-4 py-3', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((r, i) => (
          <div key={r[rowKey] ?? i} className="rounded-3xl border border-line/70 bg-white p-4 shadow-card">
            {fields.map((c, idx) => (
              <div key={c.header} className={cx('flex items-center justify-between gap-3 py-1.5 text-sm', idx === 0 && 'pb-2.5 text-base font-semibold')}>
                {idx !== 0 && <span className="text-xs text-muted">{c.header}</span>}
                <span className={cx('min-w-0', idx !== 0 && 'text-right')}>{c.render ? c.render(r) : r[c.key]}</span>
              </div>
            ))}
            {actions.length > 0 && <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-line pt-3">{actions.map((c, j) => <div key={j}>{c.render(r)}</div>)}</div>}
          </div>
        ))}
      </div>
    </>
  )
}
