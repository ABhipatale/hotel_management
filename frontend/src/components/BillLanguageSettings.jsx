import { useState } from 'react'
import { useT } from '../i18n'
import { billLang, billStyle, devicePaper } from '../lib/billLang'
import { kotPrefs } from '../lib/kotSlip'
import { textTune } from '../lib/escpos'

/** Bill language for this device: Automatic (follows the app / shop language), English or मराठी. */
export default function BillLanguageSettings() {
  const t = useT()
  const [v, setV] = useState(billLang.get())
  const [paper, setPaper] = useState(devicePaper.get())
  const [sty, setSty] = useState(billStyle.get())
  const [sp, setSp] = useState(textTune.spacing())
  const [bt, setBt] = useState(textTune.bottom())
  const ownKot = kotPrefs.hasOwnPrinter() // this device has a separate kitchen printer: the bill paper no longer changes the slip
  const opts = [['auto', t('Automatic')], ['en', 'English'], ['mr', 'मराठी']]
  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('Bill language')} className="grid grid-cols-3 gap-1 rounded-2xl bg-canvas p-1 ring-1 ring-line">
        {opts.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={v === k} onClick={() => { setV(k); billLang.set(k) }} className={`min-h-11 rounded-xl text-sm font-bold transition active:scale-95 ${v === k ? 'bg-brand text-white shadow-card' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      <div className="pt-2 text-sm font-bold">{t('Paper in the printer on this device')}</div>
      <div role="group" aria-label={t('Paper in the printer on this device')} className="grid grid-cols-2 gap-1 rounded-2xl bg-canvas p-1 ring-1 ring-line">
        {[['58mm', '58 mm'], ['80mm', '80 mm']].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={paper === k} onClick={() => { setPaper(k); devicePaper.set(k); if (k !== 'auto' && !ownKot) kotPrefs.setWidth(k) }} className={`min-h-11 rounded-xl text-sm font-bold transition active:scale-95 ${paper === k ? 'bg-brand text-white shadow-card' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      <p className="text-xs text-muted">{ownKot ? t('Choose 58 mm if this phone prints bills on narrow paper. The kitchen printer has its own paper setting.') : t('Choose 58 mm if this phone prints on narrow paper. Used for the bill and the kitchen slip on this device only.')}</p>
      <div className="pt-2 text-sm font-bold">{t('English bill printing')}</div>
      <div role="group" aria-label={t('English bill printing')} className="grid grid-cols-2 gap-1 rounded-2xl bg-canvas p-1 ring-1 ring-line">
        {[['picture', t('Neat picture')], ['text', t('Fast text')]].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={sty === k} onClick={() => { setSty(k); billStyle.set(k) }} className={`min-h-11 rounded-xl text-sm font-bold transition active:scale-95 ${sty === k ? 'bg-brand text-white shadow-card' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      {sty === 'text' && (
        <div className="space-y-2 rounded-2xl bg-canvas p-3 ring-1 ring-line">
          {[[t('Space between lines'), sp, (v) => { setSp(v); textTune.set('spacing', v) }, 12, 48, 2], [t('Blank space at the bottom'), bt, (v) => { setBt(v); textTune.set('bottom', v) }, 0, 8, 1]].map(([label, val, set, lo, hi, step]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{label}</span>
              <span className="flex items-center gap-2">
                <button type="button" aria-label="-" onClick={() => set(Math.max(lo, val - step))} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-lg font-extrabold ring-1 ring-line active:scale-95">−</button>
                <b className="w-8 text-center tabular-nums">{val}</b>
                <button type="button" aria-label="+" onClick={() => set(Math.min(hi, val + step))} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-lg font-extrabold ring-1 ring-line active:scale-95">+</button>
              </span>
            </div>
          ))}
          <p className="text-xs text-muted">{t('Lines too far apart? Press minus. The cut too close to the last line? Press plus on the bottom space. Also used for the kitchen slip.')}</p>
        </div>
      )}
      <p className="text-xs text-muted">{t('Fast text prints much quicker on a slow printer. Marathi bills are always a picture.')}</p>
      <p className="text-xs text-muted">{t('Used for the printed bill and the WhatsApp bill on this device. Automatic follows the app language.')}</p>
    </div>
  )
}
