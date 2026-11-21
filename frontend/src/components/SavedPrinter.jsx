import { useState } from 'react'
import { Check, Printer } from 'lucide-react'
import { forgetPrinter, pairPrinter, savedPrinter } from '../lib/escpos'
import { useToast } from '../context/ToastContext'
import { useT } from '../i18n'

/**
 * Choose the thermal printer once on this device; printing then connects to it automatically (no popup each time).
 * `job`: 'bill' (the bill printer, default) or 'kot' (the kitchen slip printer). Each job remembers its own printer.
 */
export default function SavedPrinter({ kind, job = 'bill', label, forgetLabel, onChange }) {
  const t = useT()
  const toast = useToast()
  const id = `${job}:${kind}`
  const [state, setState] = useState(() => ({ id, v: savedPrinter(kind, job) }))
  const saved = state.id === id ? state.v : savedPrinter(kind, job) // Bluetooth / USB switched: show that one's printer
  const setSaved = (v) => setState({ id, v })
  const [busy, setBusy] = useState(false)

  const choose = async () => {
    setBusy(true)
    try { await pairPrinter(kind, job); setSaved(savedPrinter(kind, job)); onChange?.(true); toast.success(t('Printer saved. Printing will now connect automatically.')) } catch (e) { toast.error(t(e.message)) } finally { setBusy(false) }
  }
  const forget = () => { forgetPrinter(kind, job); setSaved(null); onChange?.(false) }

  return (
    <div className="rounded-2xl bg-canvas p-3 ring-1 ring-line">
      {saved ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-white"><Check className="h-5 w-5" strokeWidth={3} /></span>
          <div className="min-w-[9rem] flex-1"><div className="truncate text-sm font-bold">{saved.name}</div><div className="text-xs text-muted">{t('Saved on this device. Print connects automatically.')}</div></div>
          <button type="button" onClick={choose} disabled={busy} className="min-h-10 rounded-xl bg-white px-3 text-xs font-bold ring-1 ring-line active:scale-95">{t('Change')}</button>
          <button type="button" onClick={forget} className="min-h-10 rounded-xl px-3 text-xs font-bold text-rose-600 active:scale-95">{forgetLabel || t('Forget')}</button>
        </div>
      ) : (
        <button type="button" onClick={choose} disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-extrabold text-white active:scale-[.98] disabled:opacity-60">
          <Printer className="h-5 w-5" /> {label || t('Choose printer (one time)')}
        </button>
      )}
    </div>
  )
}
