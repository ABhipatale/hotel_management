import { useEffect, useRef, useState } from 'react'
import { tableText } from '../../lib/format'
import { BellRing, ChefHat, Check, Flame, Printer, Settings2, StickyNote, Volume2, VolumeX } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useI18n } from '../../i18n'
import { useCounter } from '../../context/CounterContext'
import { alertSoundEnabled, ring, setAlertSound } from '../../lib/orderAlerts'
import { kotConnection, kotPrefs, printKot } from '../../lib/kotSlip'
import KotPrintSettings from '../../components/KotPrintSettings'
import { Badge, Button, Card, Chips, Empty, Modal, PageHeader, Spinner } from '../../components/ui'

const COLS = [
  { key: 'new', label: 'New', tone: 'bg-accent', next: 'cooking', action: 'Start cooking', icon: BellRing },
  { key: 'cooking', label: 'Cooking', tone: 'bg-amber-500', next: 'ready', action: 'Mark ready', icon: Flame },
  { key: 'ready', label: 'Ready', tone: 'bg-emerald-600', next: 'served', action: 'Served', icon: Check },
]
const mins = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000))
const ageTone = (m) => (m >= 20 ? 'text-rose-600' : m >= 10 ? 'text-amber-600' : 'text-emerald-600')

function Ticket({ k, col, onMove, onPrint, canPrint, tick }) {
  const { t } = useI18n()
  const { multi, counters, nameOf, colorOf } = useCounter()
  const counterName = multi && (counters.length > 1 || k.branch_id) ? nameOf(k.branch_id) : null
  const m = mins(k.created_at) // `tick` re-renders this every 30 s
  void tick
  const cancel = k.type === 'cancel'
  const where = k.order?.table ? `${tableText(t, k.order.table.number)}${k.order.table.section ? ` · ${k.order.table.section}` : ''}` : t(k.order?.type === 'delivery' ? 'Delivery' : 'Takeaway')
  return (
    <Card className={`flex flex-col !p-0 overflow-hidden ${cancel ? 'ring-2 ring-rose-500' : ''}`}>
      <div className={`flex items-center justify-between px-4 py-2.5 text-white ${cancel ? 'bg-rose-600' : col.tone}`}>
        <div className="flex items-baseline gap-2"><span className="text-xl font-extrabold tabular">#{k.number}</span><span className="text-sm font-bold opacity-90">{where}</span></div>
        <span className={`rounded-full bg-white px-2.5 py-0.5 text-xs font-extrabold tabular ${cancel ? 'text-rose-600' : ageTone(m)}`}>{m} {t('min')}</span>
      </div>
      <div className="flex-1 p-4">
        {cancel && <div className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide text-rose-700">{t('Stop – these dishes are cancelled')}</div>}
        <ul className="space-y-1.5">
          {k.items.map((i) => (
            <li key={i.id} className={`flex items-baseline gap-3 text-base font-bold ${cancel ? 'text-slate-400 line-through' : ''}`}>
              <span className="tabular w-9 shrink-0 text-xl font-extrabold text-brand">{i.quantity}×</span>
              <span>{i.name}{i.variant ? <span className="ml-1 text-sm font-semibold text-muted">({i.variant})</span> : null}</span>
            </li>
          ))}
        </ul>
        {k.note && <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" />{k.note}</p>}
        {counterName && <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-0.5 text-[11px] font-bold text-slate-600"><i className="h-2 w-2 rounded-full" style={{ background: colorOf(k.branch_id) }} />{counterName}</div>}
        <div className="mt-3 text-xs text-muted">{k.order?.order_no}{k.sender?.name ? ` · ${k.sender.name}` : ''}{k.printed_at ? ` · ${t('Printed')}` : ''}</div>
      </div>
      <div className="flex gap-2 p-3 pt-0">
        <Button className="flex-1" variant={cancel ? 'danger' : 'primary'} onClick={() => onMove(k, cancel ? 'served' : col.next)}>{cancel ? t('Got it') : t(col.action)}</Button>
        {canPrint && <Button variant="secondary" aria-label={t('Print slip')} onClick={() => onPrint(k)}><Printer className="h-4 w-4" /></Button>}
      </div>
    </Card>
  )
}

export default function Kitchen() {
  const { t, lang } = useI18n()
  const { company } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('new')
  const [sound, setSound] = useState(alertSoundEnabled())
  const [setup, setSetup] = useState(false)
  const [tick, setTick] = useState(0)
  const { data, loading, reload } = useApi('/kots', { poll: 5000 })
  const { data: done } = useApi('/kots', { params: { done: 1 }, skip: tab !== 'done', poll: tab === 'done' ? 10000 : undefined })
  const seen = useRef(null)
  const canPrint = !!company?.kot_print

  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(id) }, [])

  // New tickets: ring, and print the slip by itself when this device is set up for it
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.map((k) => k.id))
    if (seen.current) {
      const fresh = data.filter((k) => !seen.current.has(k.id) && k.status === 'new')
      if (fresh.length) {
        ring()
        if (canPrint && kotPrefs.auto('kitchen') && kotConnection()) fresh.forEach((k) => doPrint(k, true))
      }
    }
    seen.current = ids
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const doPrint = async (k, quiet) => {
    try {
      await printKot(k, company, lang)
      api.post(`/kots/${k.id}/printed`).catch(() => {})
      if (!quiet) toast.success(t('Sent to printer'))
    } catch (e) { toast.error(e.message ? t(e.message) : t('Printing failed')) }
  }
  const move = async (k, status) => {
    try { await api.patch(`/kots/${k.id}/status`, { status }); reload() } catch (e) { toast.error(e) }
  }

  if (loading && !data) return <Spinner />
  const by = (s) => (data || []).filter((k) => k.status === s)
  const counts = Object.fromEntries(COLS.map((c) => [c.key, by(c.key).length]))
  const tabs = [...COLS.map((c) => [c.key, `${t(c.label)} (${counts[c.key]})`]), ['done', t('Done today')]]

  return (
    <>
      <PageHeader
        title={t('Kitchen')}
        sub={t('Live tickets from every waiter and captain')}
        actions={(
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" aria-label={t('Sound')} onClick={() => { setAlertSound(!sound); setSound(!sound) }}>{sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button>
            {canPrint && <Button size="sm" variant="secondary" onClick={() => setSetup(true)}><Settings2 className="h-4 w-4" /> {t('Print settings')}</Button>}
          </div>
        )}
      />
      <Chips items={tabs} value={tab} onChange={setTab} />

      {tab === 'done' ? (
        !done?.length ? <Empty icon={ChefHat} title={t('Nothing finished yet today')} /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {done.map((k) => (
              <Card key={k.id} className="!p-4">
                <div className="flex items-center justify-between"><b>#{k.number} · {k.order?.table ? tableText(t, k.order.table.number) : t('Takeaway')}</b><Badge tone={k.status === 'cancelled' ? 'red' : 'green'}>{t(k.status === 'cancelled' ? 'Cancelled' : 'Served')}</Badge></div>
                <div className="mt-2 text-sm text-slate-600">{k.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLS.map((c) => (
            <section key={c.key} className={`${tab === c.key ? 'block' : 'hidden'} lg:block`}>
              <div className="mb-2 hidden items-center gap-2 text-sm font-extrabold lg:flex"><span className={`h-2.5 w-2.5 rounded-full ${c.tone}`} />{t(c.label)}<span className="text-muted">({counts[c.key]})</span></div>
              <div className="space-y-3">
                {by(c.key).length ? by(c.key).map((k) => <Ticket key={k.id} k={k} col={c} onMove={move} onPrint={doPrint} canPrint={canPrint} tick={tick} />)
                  : <Empty icon={c.icon} title={t('No tickets')} hint={c.key === 'new' ? t('New orders from waiters appear here with a sound.') : undefined} />}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal open={setup} onClose={() => setSetup(false)} title={t('Print settings')}><KotPrintSettings where="kitchen" /></Modal>
    </>
  )
}
