import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw, Send } from 'lucide-react'
import { warmOfflineCopy } from '../lib/api'
import { money, timeIST } from '../lib/format'
import { outbox, syncOutbox, useOnline, useOutbox } from '../lib/outbox'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useT } from '../i18n'
import { Button, Modal } from './ui'

/**
 * Shown while there is no internet or orders are waiting to be sent. Only the owner can take orders and print bills offline;
 * everybody else just sees that the connection is gone. Also sends the waiting orders by itself when the internet is back.
 */
export default function OfflineBar() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const online = useOnline()
  const { pending, done } = useOutbox()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const isOwner = user?.role === 'owner'
  const mine = pending.filter((e) => e.userId === user?.id)

  const send = async (quiet) => {
    if (!user) return
    setBusy(true)
    const r = await syncOutbox(user.id)
    setBusy(false)
    if (r?.sent) toast.success(`${t('Sent {n} offline order(s)', { n: r.sent })}${r.pairs.length ? ` · ${r.pairs.join(', ')}` : ''}`)
    else if (!quiet && r && !r.failed && mine.length) toast.error(t('Still no internet. Your orders are safe on this device.'))
  }

  // send by itself: when the internet returns, when the app opens, and every 20 s while something waits
  useEffect(() => {
    if (!user) return undefined
    const run = () => send(true)
    run()
    window.addEventListener('online', run)
    const id = setInterval(() => { if (!document.hidden) run() }, 20000)
    return () => { window.removeEventListener('online', run); clearInterval(id) }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // the owner keeps a fresh offline copy of the menu, tables and shop details
  useEffect(() => {
    if (isOwner && online) warmOfflineCopy()
  }, [isOwner, online])

  if (online && !mine.length) return null
  const failed = mine.filter((e) => e.status === 'failed').length

  return (
    <>
      <button onClick={() => setOpen(true)} className={`flex w-full items-center justify-center gap-2 px-4 py-2 text-center text-[13px] font-bold text-white ${online ? 'bg-accent' : 'bg-slate-800'}`}>
        {online ? <Send className="h-4 w-4 shrink-0" /> : <CloudOff className="h-4 w-4 shrink-0" />}
        <span>
          {!online ? (isOwner ? t('Offline: you can still take orders and print bills.') : t('No internet connection.')) : t('Sending your offline orders…')}
          {mine.length > 0 && ` · ${t('{n} waiting', { n: mine.length })}`}
          {failed > 0 && ` · ${t('{n} need your attention', { n: failed })}`}
        </span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('Offline orders')}>
        <div className="space-y-4">
          {!mine.length && <p className="rounded-2xl bg-canvas p-4 text-center text-sm text-muted">{t('Nothing is waiting.')}</p>}
          {mine.map((e) => (
            <div key={e.id} className={`rounded-2xl p-3.5 ring-1 ${e.status === 'failed' ? 'bg-rose-50 ring-rose-200' : 'bg-canvas ring-line'}`}>
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">{e.local?.bill_no || e.local?.order_no}</b>
                <span className="text-xs text-muted">{timeIST(e.createdAt)}{e.total != null ? ` · ${money(e.total)}` : ''}</span>
              </div>
              <div className="mt-1 text-xs leading-snug text-muted">{e.summary}</div>
              {e.status === 'failed' ? (
                <>
                  <p className="mt-2 text-xs font-semibold text-rose-700">{e.error}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { outbox.retry(e.id); send(true) }}>{t('Try again')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => outbox.remove(e.id)}>{t('Discard')}</Button>
                  </div>
                </>
              ) : <p className="mt-2 text-xs font-semibold text-accent-dark">{t('Waiting to be sent')}</p>}
            </div>
          ))}
          {mine.length > 0 && <Button className="w-full" loading={busy} disabled={!online} onClick={() => send(false)}><RefreshCw className="h-4 w-4" /> {t('Send now')}</Button>}
          {done.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-muted">{t('Recently sent')}</div>
              <ul className="space-y-1 text-xs">
                {done.slice(0, 8).map((d) => <li key={d.id} className="flex justify-between gap-2 rounded-xl bg-canvas px-3 py-2"><span>{d.local}</span><b className="text-brand">→ {d.server}</b></li>)}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-muted">{t('A bill printed offline has a temporary number (OFF-…). Its real bill number is shown here once it is sent.')}</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
