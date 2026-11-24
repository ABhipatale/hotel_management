import { useEffect } from 'react'
import { tableText } from '../lib/format'
import { BellRing, Printer, X } from 'lucide-react'
import { useT } from '../i18n'

/**
 * Banner stack at the top of the screen for orders placed by others. Tap to open the orders; each one fades out after 12 s.
 * Below them, "KOT not printed" banners (company switch kot_unprinted_alert): a kitchen slip nobody printed, with Print KOT.
 * Those stay until the slip is printed (here or on another device) or closed with X; at most 3, the rest are on the Orders page.
 */
export default function OrderAlertBanner({ banners, onOpen, onDismiss, kots = [], onPrintKot, onCloseKot, printingKot, onOpenOrders }) {
  const t = useT()
  useEffect(() => {
    const timers = banners.map((b) => setTimeout(() => onDismiss(b.id), 12000))
    return () => timers.forEach(clearTimeout)
  }, [banners, onDismiss])
  if (!banners.length && !kots.length) return null

  const who = (o) => (o.source === 'qr' ? t('Customer (QR)') : `${o.by_role === 'captain' ? t('Captain') : t('Waiter')}${o.by ? `: ${o.by}` : ''}`)
  const sender = (k) => (k.sender ? `${k.sender.role === 'captain' ? t('Captain') : k.sender.role === 'waiter' ? t('Waiter') : t(k.sender.role === 'counter' ? 'Counter manager' : 'Owner')}: ${k.sender.name}` : '')
  const place = (k) => (k.order?.table?.number ? tableText(t, k.order.table.number) : k.order?.type === 'takeaway' ? t('Takeaway') : k.order?.type === 'delivery' ? t('Delivery') : t('New order'))
  const shown = kots.slice(0, 3)
  return (
    <div role="status" aria-live="assertive" className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      {banners.map((o) => (
        <div key={o.id} className={`animate-pop pointer-events-auto flex w-full max-w-md items-stretch overflow-hidden rounded-2xl bg-white shadow-float ring-1 ring-line ${o.by_role === 'captain' ? 'border-l-[6px] border-[#7C3AED]' : 'border-l-[6px] border-accent'}`}>
          <button type="button" onClick={() => onOpen(o)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white"><BellRing className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-extrabold leading-tight">
                {o.table ? tableText(t, o.table) : t('New order')}{o.section ? ` · ${o.section}` : ''}
              </span>
              <span className="block truncate text-xs font-semibold text-muted">{who(o)} · {t('{n} item(s)', { n: o.items_count })}</span>
              <span className="block truncate text-xs text-slate-600">{o.items.join(', ')}</span>
            </span>
          </button>
          <button type="button" aria-label={t('Close')} onClick={() => onDismiss(o.id)} className="grid w-11 shrink-0 place-items-center text-slate-400 active:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      ))}
      {shown.map((k) => (
        <div key={`kot-${k.id}`} className="animate-pop pointer-events-auto flex w-full max-w-md items-stretch overflow-hidden rounded-2xl border-l-[6px] border-rose-500 bg-white shadow-float ring-1 ring-rose-200">
          <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><Printer className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-extrabold leading-tight">{place(k)}{k.order?.table?.section ? ` · ${k.order.table.section}` : ''}</span>
              {/* wraps, never cut: in Marathi the "not" comes last ("प्रिंट झाले नाही"), so a cut line would read "printed" */}
              <span className="block text-xs font-bold leading-tight text-rose-700">{t(k.type === 'cancel' ? 'Cancel KOT #{n} not printed' : 'KOT #{n} not printed', { n: k.number })}</span>
              <span className="block truncate text-xs text-slate-600">{[sender(k), (k.items || []).slice(0, 3).map((i) => `${i.quantity} x ${i.name}`).join(', ')].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center pl-2">
            <button type="button" onClick={() => onPrintKot?.(k)} disabled={!!printingKot} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-rose-600 px-3.5 text-xs font-extrabold text-white shadow-card transition active:scale-95 disabled:opacity-60">
              <Printer className="h-4 w-4" />{printingKot === k.id ? t('Printing…') : t('Print KOT')}
            </button>
          </div>
          <button type="button" aria-label={t('Close')} onClick={() => onCloseKot?.(k.id)} className="grid w-11 shrink-0 place-items-center text-slate-400 active:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      ))}
      {kots.length > shown.length && (
        <button type="button" onClick={onOpenOrders} className="pointer-events-auto rounded-full bg-rose-600 px-4 py-2 text-xs font-extrabold text-white shadow-float active:scale-95">
          {t('+{n} more KOTs not printed', { n: kots.length - shown.length })}
        </button>
      )}
    </div>
  )
}
