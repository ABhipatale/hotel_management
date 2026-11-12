import { useEffect } from 'react'
import { BellRing, X } from 'lucide-react'
import { useT } from '../i18n'

/** Banner stack at the top of the screen for orders placed by others. Tap to open the orders; each one fades out after 12 s. */
export default function OrderAlertBanner({ banners, onOpen, onDismiss }) {
  const t = useT()
  useEffect(() => {
    const timers = banners.map((b) => setTimeout(() => onDismiss(b.id), 12000))
    return () => timers.forEach(clearTimeout)
  }, [banners, onDismiss])
  if (!banners.length) return null

  const who = (o) => (o.source === 'qr' ? t('Customer (QR)') : `${o.by_role === 'captain' ? t('Captain') : t('Waiter')}${o.by ? `: ${o.by}` : ''}`)
  return (
    <div role="status" aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      {banners.map((o) => (
        <div key={o.id} className={`animate-pop pointer-events-auto flex w-full max-w-md items-stretch overflow-hidden rounded-2xl bg-white shadow-float ring-1 ring-line ${o.by_role === 'captain' ? 'border-l-[6px] border-[#7C3AED]' : 'border-l-[6px] border-accent'}`}>
          <button type="button" onClick={() => onOpen(o)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white"><BellRing className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-extrabold leading-tight">
                {o.table ? t('Table {n}', { n: o.table }) : t('New order')}{o.section ? ` · ${o.section}` : ''}
              </span>
              <span className="block truncate text-xs font-semibold text-muted">{who(o)} · {t('{n} item(s)', { n: o.items_count })}</span>
              <span className="block truncate text-xs text-slate-600">{o.items.join(', ')}</span>
            </span>
          </button>
          <button type="button" aria-label={t('Close')} onClick={() => onDismiss(o.id)} className="grid w-11 shrink-0 place-items-center text-slate-400 active:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  )
}
