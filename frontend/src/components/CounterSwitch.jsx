import { LayoutGrid, Store } from 'lucide-react'
import { useCounter } from '../context/CounterContext'
import { useT } from '../i18n'
import { cx } from './ui'

/**
 * Multi-counter companies only.
 *  - Owner: pills to look at every counter or just one (the whole app follows the choice).
 *  - Counter login: a fixed badge with the counter they work in.
 * `dark` = on the teal phone header, otherwise on the white desktop header.
 */
export default function CounterSwitch({ dark, className }) {
  const { multi, isOwner, counters, selected, select, current } = useCounter()
  const t = useT()
  if (!multi) return null

  if (!isOwner) {
    if (!current) return null
    return (
      <span className={cx('inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-extrabold', dark ? 'bg-white/15 text-white ring-1 ring-white/25' : 'bg-brand-soft text-brand', className)}>
        <Store className="h-4 w-4" />{current.name}
      </span>
    )
  }

  const pill = (active, children, key, onClick) => (
    <button key={key} onClick={onClick} aria-pressed={active}
      className={cx('inline-flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] font-bold transition duration-200 active:scale-95',
        dark ? (active ? 'bg-white text-brand shadow-card' : 'bg-white/10 text-white/85 ring-1 ring-white/20') : (active ? 'bg-brand text-white shadow-[0_6px_14px_-6px_rgb(23_100_95/.55)]' : 'bg-canvas text-slate-600 ring-1 ring-line hover:ring-slate-300'))}>
      {children}
    </button>
  )
  return (
    <div className={cx('no-scrollbar flex items-center gap-1.5 overflow-x-auto overscroll-x-contain', className)} role="group" aria-label={t('Counter')}>
      {pill(!selected, <><LayoutGrid className="h-4 w-4" />{t('All counters')}</>, 'all', () => select(''))}
      {counters.filter((c) => c.is_active).map((c) => pill(String(c.id) === String(selected), <><i className="h-2.5 w-2.5 rounded-full ring-2 ring-white/70" style={{ background: c.color }} />{c.name}</>, c.id, () => select(c.id)))}
    </div>
  )
}
