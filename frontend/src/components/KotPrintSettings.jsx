import { useEffect, useRef, useState } from 'react'
import { Printer, Save } from 'lucide-react'
import { useI18n } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { kotConnection, kotPrefs, kotSharesBillPrinter, printKotTest } from '../lib/kotSlip'
import { textTune } from '../lib/escpos'
import SavedPrinter from './SavedPrinter'
import { readyAlertOn, setReadyAlert } from '../lib/kotAlerts'
import { Button, Switch } from './ui'

/** What is saved on this device right now. */
const load = (where, companyDefault) => ({
  kind: kotPrefs.conn() || kotConnection()?.kind || (navigator.bluetooth ? 'bluetooth' : 'usb'),
  width: kotPrefs.width(),
  style: kotPrefs.style(),
  lang: kotPrefs.langChoice(),
  mode: kotPrefs.orderMode(companyDefault),
  auto: kotPrefs.auto(where),
  ready: readyAlertOn(),
  spacing: textTune.spacing('kot'),
  bottom: textTune.bottom('kot'),
})

/**
 * Kitchen-slip (KOT) printer for THIS device: its own printer (separate from the bill printer), paper width, slip style and when to
 * print by itself. Choices are kept as a draft and written only when "Save KOT printer" is pressed. Choosing / forgetting the printer
 * itself happens at once (the browser's own popup grants access to it).
 */
export default function KotPrintSettings({ where, onSaved }) {
  const { t, lang } = useI18n()
  const { company, user } = useAuth()
  const toast = useToast()
  const [saved, setSaved] = useState(() => load(where, company?.kot_print_mode))
  const [d, setD] = useState(saved)
  const [, setTick] = useState(0) // re-read the printer status line after Choose / Forget
  const [testing, setTesting] = useState(false)
  const savedRef = useRef(saved)
  useEffect(() => { savedRef.current = saved }, [saved])
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }))
  const dirty = Object.keys(saved).some((k) => saved[k] !== d[k])

  // Another panel on the same page (bill paper width) can change a KOT value: show it, unless it is being edited here.
  useEffect(() => {
    const on = () => {
      const fresh = load(where, company?.kot_print_mode)
      const prev = savedRef.current
      setD((x) => Object.fromEntries(Object.keys(fresh).map((k) => [k, x[k] === prev[k] ? fresh[k] : x[k]])))
      setSaved(fresh)
    }
    window.addEventListener('hms:kotprefs', on)
    return () => window.removeEventListener('hms:kotprefs', on)
  }, [where, company?.kot_print_mode])

  const save = () => {
    // only what changed is written: an untouched value keeps following its default (company default, bill printer tuning…)
    if (d.kind !== saved.kind) kotPrefs.setConn(d.kind)
    if (d.width !== saved.width) kotPrefs.setWidth(d.width)
    if (d.style !== saved.style) kotPrefs.setStyle(d.style)
    if (d.lang !== saved.lang) kotPrefs.setLang(d.lang)
    if (where === 'order') { if (d.mode !== saved.mode) kotPrefs.setOrderMode(d.mode) } else if (d.auto !== saved.auto) kotPrefs.setAuto(where, d.auto)
    if (d.ready !== saved.ready) setReadyAlert(d.ready)
    if (d.spacing !== saved.spacing) textTune.set('spacing', d.spacing, 'kot')
    if (d.bottom !== saved.bottom) textTune.set('bottom', d.bottom, 'kot')
    const fresh = load(where, company?.kot_print_mode)
    setSaved(fresh); setD(fresh)
    toast.success(t('KOT printer settings saved'))
    onSaved?.()
  }

  const test = async () => {
    setTesting(true)
    try {
      const style = await printKotTest(company, user, lang)
      toast.success(style === 'text' ? t('Test slip sent (fast text)') : t('Test slip sent (picture)'))
    } catch (e) { toast.error(e.message ? t(e.message) : t('Printing failed')) } finally { setTesting(false) }
  }

  // the printer slips really go to (after Save): this device's own kitchen printer, or the bill printer as before
  const target = kotConnection()
  const choice = (on) => `min-h-11 rounded-xl text-sm font-bold ring-1 transition active:scale-95 ${on ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`

  return (
    <div className="space-y-4">
      <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${target ? 'bg-brand-soft text-brand' : 'bg-amber-50 text-amber-800'}`}>
        {!target ? t('No printer chosen yet: kitchen slips cannot print on this device.')
          : target.job === 'kot' ? t('Kitchen slips print on: {name}', { name: target.name })
            : t('No separate kitchen printer: slips print on the bill printer ({name}).', { name: target.name })}
        {target?.job === 'kot' && kotSharesBillPrinter() && <div className="mt-0.5 font-normal">{t('Same printer as the bills: slips and bills print one after the other.')}</div>}
      </div>
      <div className="flex gap-2">
        {[['bluetooth', 'Bluetooth'], ['usb', 'USB']].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={d.kind === k} onClick={() => set('kind', k)} className={`flex-1 ${choice(d.kind === k)}`}>{l}</button>
        ))}
      </div>
      <SavedPrinter
        kind={d.kind}
        job="kot"
        label={t('Choose kitchen printer')}
        forgetLabel={t('Use the bill printer')}
        onChange={(has) => {
          if (has) { kotPrefs.setConn(d.kind); setSaved((x) => ({ ...x, kind: d.kind })) } // a printer just chosen is used right away
          setTick((n) => n + 1)
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        {['58mm', '80mm'].map((w) => (
          <button key={w} type="button" aria-pressed={d.width === w} onClick={() => set('width', w)} className={choice(d.width === w)}>{w}</button>
        ))}
      </div>
      {where === 'order' ? (
        <div className="space-y-2">
          <div className="text-sm font-bold">{t('When I place an order')}</div>
          <div className="grid gap-2">
            {[['auto', 'Print the kitchen slip automatically', 'No questions asked: fastest for a busy counter.'], ['ask', 'Ask me each time (popup)', 'A quick Yes / No: print the kitchen slip now?'], ['off', 'Do not print', 'The kitchen screen still gets the ticket.']].map(([k, l, h]) => (
              <button key={k} type="button" onClick={() => set('mode', k)} aria-pressed={d.mode === k} className={`rounded-2xl p-3 text-left ring-1 transition active:scale-[.99] ${d.mode === k ? 'bg-brand-soft ring-2 ring-brand' : 'bg-white ring-line'}`}>
                <div className={`text-sm font-extrabold ${d.mode === k ? 'text-brand' : ''}`}>{t(l)}</div>
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
          checked={d.auto}
          onChange={(v) => set('auto', v)}
        />
      )}
      <div>
        <div className="mb-1 text-sm font-bold">{t('Slip language')}</div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {[['auto', t('Automatic')], ['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिंदी']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={d.lang === k} onClick={() => set('lang', k)} className={`px-1 ${choice(d.lang === k)}`}>{l}</button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{t('Automatic follows the app language (Marathi app: Marathi slip, otherwise English). A Marathi slip prints the Marathi dish name when the dish has one.')}</p>
      </div>
      <div>
        <div className="mb-1 text-sm font-bold">{t('Slip printing')}</div>
        <div className="grid grid-cols-2 gap-2">
          {[['picture', 'Neat picture'], ['text', 'Fast text']].map(([k2, l]) => (
            <button key={k2} type="button" aria-pressed={d.style === k2} onClick={() => set('style', k2)} className={choice(d.style === k2)}>{t(l)}</button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{t('Fast text prints much quicker on a slow printer. Marathi or Hindi words are sent as small pictures, only where they appear, so Marathi slips stay fast.')}</p>
      </div>
      {d.style === 'text' && (
        <div className="space-y-2 rounded-2xl bg-canvas p-3 ring-1 ring-line">
          {[[t('Space between lines'), 'spacing', 12, 48, 2], [t('Blank space at the bottom'), 'bottom', 0, 8, 1]].map(([label, k, lo, hi, step]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{label}</span>
              <span className="flex items-center gap-2">
                <button type="button" aria-label="-" onClick={() => set(k, Math.max(lo, d[k] - step))} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-lg font-extrabold ring-1 ring-line active:scale-95">−</button>
                <b className="w-8 text-center tabular-nums">{d[k]}</b>
                <button type="button" aria-label="+" onClick={() => set(k, Math.min(hi, d[k] + step))} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-lg font-extrabold ring-1 ring-line active:scale-95">+</button>
              </span>
            </div>
          ))}
          <p className="text-xs text-muted">{t('For the kitchen printer only. Lines too far apart? Press minus. The cut too close to the last line? Press plus on the bottom space.')}</p>
        </div>
      )}
      <Switch
        label={t('Show "KOT is ready" popup and beep')}
        hint={t('Only on this device. Turn off if you do not want a notification when the kitchen finishes a ticket.')}
        checked={d.ready}
        onChange={(v) => set('ready', v)}
      />
      <div className="space-y-2">
        {dirty && <p className="text-center text-xs font-bold text-amber-700">{t('You have unsaved changes.')}</p>}
        <Button type="button" className="w-full" onClick={save} disabled={!dirty}><Save className="h-4 w-4" /> {t('Save KOT printer')}</Button>
        <Button type="button" variant="secondary" className="w-full" onClick={test} loading={testing} disabled={!target || dirty || testing}><Printer className="h-4 w-4" /> {t('Test print')}</Button>
        {dirty && target && <p className="text-center text-xs text-muted">{t('Save first, then test.')}</p>}
      </div>
    </div>
  )
}
