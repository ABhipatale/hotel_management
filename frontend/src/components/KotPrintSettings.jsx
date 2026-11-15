import { useState } from 'react'
import { useT } from '../i18n'
import { kotPrefs } from '../lib/kotSlip'
import SavedPrinter from './SavedPrinter'
import { Switch } from './ui'

/** Kitchen-slip printing choices for THIS device: which printer, paper width, and when to print by itself. */
export default function KotPrintSettings({ where }) {
  const t = useT()
  const [width, setWidth] = useState(kotPrefs.width())
  const [auto, setAuto] = useState(kotPrefs.auto(where))
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
      <Switch
        label={where === 'kitchen' ? t('Print a slip when a new ticket arrives') : t('Print a kitchen slip when I place an order')}
        hint={t('Only on this device. Needs a saved printer above.')}
        checked={auto}
        onChange={(v) => { setAuto(v); kotPrefs.setAuto(where, v) }}
      />
    </div>
  )
}
