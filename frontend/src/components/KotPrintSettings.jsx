import { useState } from 'react'
import { useT } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { kotPrefs } from '../lib/kotSlip'
import { kotLang } from '../lib/billLang'
import { useToast } from '../context/ToastContext'
import SavedPrinter from './SavedPrinter'
import { readyAlertOn, setReadyAlert } from '../lib/kotAlerts'
import { Button, Switch } from './ui'

/** Kitchen-slip printing choices for THIS device: which printer, paper width, and when to print by itself. */
export default function KotPrintSettings({ where }) {
  const t = useT()
  const toast = useToast()
  const { company } = useAuth()
  const [lang, setLang] = useState(kotLang.get())
  const [savedLang, setSavedLang] = useState(kotLang.get())
  const [width, setWidth] = useState(kotPrefs.width())
  const [auto, setAuto] = useState(kotPrefs.auto(where))
  const [mode, setMode] = useState(kotPrefs.orderMode(company?.kot_print_mode))
  const [ready, setReady] = useState(readyAlertOn())
  const [style, setStyle] = useState(kotPrefs.style())
  const [kind, setKind] = useState(() => (navigator.bluetooth ? 'bluetooth' : 'usb'))
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[['bluetooth', 'Bluetooth'], ['usb', 'USB']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`min-h-11 flex-1 rounded-xl text-sm font-bold ring-1 transition active:scale-95 ${kind === k ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{l}</button>
        ))}
      </div>
      <SavedPrinter kind={kind} />
      <div className="grid grid-cols-2 gap-2">
        {['58mm', '80mm'].map((w) => (
          <button key={w} type="button" onClick={() => { setWidth(w); kotPrefs.setWidth(w) }} className={`min-h-11 rounded-xl text-sm font-bold ring-1 transition active:scale-95 ${width === w ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{w}</button>
        ))}
      </div>
      {where === 'order' ? (
        <div className="space-y-2">
          <div className="text-sm font-bold">{t('When I place an order')}</div>
          <div className="grid gap-2">
            {[['auto', 'Print the kitchen slip automatically', 'No questions asked: fastest for a busy counter.'], ['ask', 'Ask me each time (popup)', 'A quick Yes / No: print the kitchen slip now?'], ['off', 'Do not print', 'The kitchen screen still gets the ticket.']].map(([k, l, h]) => (
              <button key={k} type="button" onClick={() => { setMode(k); kotPrefs.setOrderMode(k) }} aria-pressed={mode === k} className={`rounded-2xl p-3 text-left ring-1 transition active:scale-[.99] ${mode === k ? 'bg-brand-soft ring-2 ring-brand' : 'bg-white ring-line'}`}>
                <div className={`text-sm font-extrabold ${mode === k ? 'text-brand' : ''}`}>{t(l)}</div>
                <div className="text-xs text-muted">{t(h)}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{t('Only on this device. Needs a saved printer above.')}</p>
        </div>
      ) : (
        <Switch
          label={t('Print a slip when a new ticket arrives')}
          hint={t('Only on this device. Needs a saved printer above.')}
          checked={auto}
          onChange={(v) => { setAuto(v); kotPrefs.setAuto(where, v) }}
        />
      )}
      <div>
        <div className="mb-1 text-sm font-bold">{t('Kitchen slip language')}</div>
        <div className="grid grid-cols-3 gap-2">
          {[['auto', 'Same as app'], ['en', 'English'], ['mr', 'मराठी']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={lang === k} onClick={() => setLang(k)} className={`min-h-11 rounded-xl text-sm font-bold ring-1 transition active:scale-95 ${lang === k ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{k === 'auto' ? t(l) : l}</button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{t('Only on this device. "Same as app" prints Marathi slips when the app is in Marathi.')}</p>
        <Button type="button" className="mt-2 w-full" disabled={lang === savedLang} onClick={() => { kotLang.set(lang); setSavedLang(lang); toast.success(t('Saved')) }}>{t('Save')}</Button>
      </div>
      <div>
        <div className="mb-1 text-sm font-bold">{t('Slip printing')}</div>
        <div className="grid grid-cols-2 gap-2">
          {[['picture', 'Neat picture'], ['text', 'Fast text']].map(([k2, l]) => (
            <button key={k2} type="button" aria-pressed={style === k2} onClick={() => { setStyle(k2); kotPrefs.setStyle(k2) }} className={`min-h-11 rounded-xl text-sm font-bold ring-1 transition active:scale-95 ${style === k2 ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{t(l)}</button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{t('Fast text prints much quicker on a slow printer. Marathi slips are always a picture.')}</p>
      </div>
      <Switch
        label={t('Show "KOT is ready" popup and beep')}
        hint={t('Only on this device. Turn off if you do not want a notification when the kitchen finishes a ticket.')}
        checked={ready}
        onChange={(v) => { setReady(v); setReadyAlert(v) }}
      />
    </div>
  )
}
