import { useState } from 'react'
import { useT } from '../i18n'
import { billLang } from '../lib/billLang'

/** Bill language for this device: Automatic (follows the app / shop language), English or मराठी. */
export default function BillLanguageSettings() {
  const t = useT()
  const [v, setV] = useState(billLang.get())
  const opts = [['auto', t('Automatic')], ['en', 'English'], ['mr', 'मराठी']]
  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('Bill language')} className="grid grid-cols-3 gap-1 rounded-2xl bg-canvas p-1 ring-1 ring-line">
        {opts.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={v === k} onClick={() => { setV(k); billLang.set(k) }} className={`min-h-11 rounded-xl text-sm font-bold transition active:scale-95 ${v === k ? 'bg-brand text-white shadow-card' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      <p className="text-xs text-muted">{t('Used for the printed bill and the WhatsApp bill on this device. Automatic follows the app language.')}</p>
    </div>
  )
}
