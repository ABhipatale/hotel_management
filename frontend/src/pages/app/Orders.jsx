import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChefHat, Pencil, Plus, Printer, QrCode, StickyNote } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { tableText, ago, money, today } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useApproval } from '../../context/ApprovalContext'
import { useCounter } from '../../context/CounterContext'
import { useI18n } from '../../i18n'
import { KOT_PRINTED_EVENT, canPrintForOthers, printUnprintedKot, unprintedAlertOn } from '../../lib/kotUnprinted'
import { Badge, Button, Card, Chips, Empty, Input, Modal, PageHeader, Spinner, statusTone } from '../../components/ui'

const TABS = [['open', 'Open'], ['all', 'All today']]
const lbl = (t, s) => t(String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))

export default function Orders() {
  const { can, company, user } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const approve = useApproval()
  const { t, lang } = useI18n()
  const nav = useNavigate()
  const { allCounters, nameOf, colorOf } = useCounter()
  const [tab, setTab] = useState('open')
  const { data, loading, reload } = useApi('/orders', { params: tab === 'open' ? { open: 1 } : { date: today() }, poll: 8000 })

  // cancelling asks WHY first (saved with who cancelled it; shown in Reports > Discounts & voids)
  const [cancelFor, setCancelFor] = useState(null)
  const [why, setWhy] = useState('')
  const REASONS = ['Customer cancelled', 'Wrong order', 'Dish not available', 'Duplicate order', 'Customer left']
  const confirmCancel = async () => {
    const reason = why.trim()
    if (reason.length < 3) return
    const o = cancelFor
    setCancelFor(null); setWhy('')
    try { await approve((pin) => api.patch(`/orders/${o.id}/status`, { status: 'cancelled', reason }, pin ? { headers: { 'X-Approval-Pin': pin } } : undefined)); reload() } catch (e) { if (!e.cancelled) toast.error(e) }
  }
  const setStatus = async (o, status) => {
    // cancelling an order the kitchen already started may need the owner's approval PIN (asked here when the server wants it)
    try { await approve((pin) => api.patch(`/orders/${o.id}/status`, { status }, pin ? { headers: { 'X-Approval-Pin': pin } } : undefined)); reload() } catch (e) { if (!e.cancelled) toast.error(e) }
  }
  // "KOT not printed" (company switch): a red mark on each slip nobody printed; owner / counter manager / captains print it here
  const kotMarks = unprintedAlertOn(company)
  const canPrintKot = canPrintForOthers(company, user)
  const [printing, setPrinting] = useState(null)
  const reloadRef = useRef(reload)
  useEffect(() => { reloadRef.current = reload })
  useEffect(() => { // a slip printed from the banner (or here) shows as printed at once, not at the next refresh
    if (!kotMarks) return undefined
    const on = () => reloadRef.current()
    window.addEventListener(KOT_PRINTED_EVENT, on)
    return () => window.removeEventListener(KOT_PRINTED_EVENT, on)
  }, [kotMarks])
  const printOne = async (k) => {
    if (printing) return
    setPrinting(k.id)
    try {
      const r = await printUnprintedKot(k.id, company, lang)
      toast.success(r === 'printed' ? t('KOT #{n} printed', { n: k.number }) : t('Already printed or being cooked'))
    } catch (e) {
      toast.error(e?.message ? t(e.message) : t('Printing failed'))
    } finally {
      setPrinting(null)
    }
  }
  const bill = async (o) => {
    try { await api.post(`/orders/${o.id}/bill`); toast.success(t('Bill generated — open Billing to collect payment')); reload() } catch (e) { toast.error(e) }
  }

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title={t('Orders')} actions={can('orders.create') && <Link to="/app/order/new"><Button variant="accent" size="sm"><Plus className="h-4 w-4" /> {t('New order')}</Button></Link>} />
      <Chips items={TABS.map(([k, l]) => [k, t(l)])} value={tab} onChange={setTab} />

      {!data?.length ? <Empty title={t('No orders')} hint={t('New orders from waiters and customer QR scans appear here.')} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((o) => {
            const editable = !['paid', 'cancelled'].includes(o.status) && o.bill?.status !== 'paid' && can('orders.create')
            return (
            <Card key={o.id} interactive={editable} onClick={editable ? (e) => { if (!e.target.closest('button, a')) nav(`/app/order/new?edit=${o.id}`) } : undefined} className={`flex flex-col ${o.waiter?.role === 'captain' ? 'border-l-[6px] border-[#7C3AED]' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 font-semibold">{o.table ? tableText(t, o.table.number) : lbl(t, o.type)}{o.table?.section && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{o.table.section}</span>} {o.source === 'qr' && <QrCode className="h-3.5 w-3.5 text-brand" />}</div>
                  {allCounters && nameOf(o.branch_id) && <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-0.5 text-[11px] font-bold text-slate-600"><i className="h-2 w-2 rounded-full" style={{ background: colorOf(o.branch_id) }} />{nameOf(o.branch_id)}</span>}
                  <div className="text-xs text-muted">{o.order_no} · {t('{time} ago', { time: ago(o.created_at) })}{o.waiter && o.waiter.role !== 'captain' ? ` · ${o.waiter.name}` : ''}</div>
                  {o.waiter?.role === 'captain' && <div className="mt-1"><span className="inline-flex items-center rounded-full bg-[#EDE9FE] px-2.5 py-1 text-[11px] font-bold text-[#5B21B6]">{t('Captain')}: {o.waiter.name}</span></div>}
                </div>
                <Badge tone={statusTone(o.status)}>{lbl(t, o.status)}</Badge>
              </div>
              {(() => {
                const lines = o.items.filter((i) => i.status !== 'cancelled')
                // Several people served this table: show who added each dish
                const many = new Set(lines.map((i) => i.added_by).filter(Boolean)).size > 1
                return (
                  <ul className="my-3 flex-1 space-y-1 text-sm">
                    {lines.map((i) => (
                      <li key={i.id} className="flex items-baseline justify-between gap-3">
                        <span>{i.quantity}× {i.name}{i.variant ? ` (${i.variant})` : ''}{many && i.adder?.name && <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-[11px] font-bold text-slate-500">{i.adder.name}</span>}</span>
                        <b className="tabular shrink-0 text-slate-700">{money(i.price * i.quantity)}</b>
                      </li>
                    ))}
                  </ul>
                )
              })()}
              {(() => {
                // kitchen tickets; with "KOT not printed" on, a slip nobody printed (also a "stop" slip) is red, with Print KOT
                const unprinted = (k) => kotMarks && !k.printed_at && k.status === 'new'
                const list = (o.kots || []).filter((k) => k.status !== 'cancelled' && (k.type === 'new' || unprinted(k)))
                if (!list.length) return null
                return (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {list.map((k) => unprinted(k) ? (
                      <span key={k.id} className="inline-flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200"><Printer className="h-3 w-3" />{t(k.type === 'cancel' ? 'Cancel KOT #{n} not printed' : 'KOT #{n} not printed', { n: k.number })}</span>
                        {canPrintKot && <button type="button" onClick={() => printOne(k)} disabled={!!printing} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-rose-600 px-3 text-[11px] font-extrabold text-white shadow-card active:scale-95 disabled:opacity-60">{printing === k.id ? t('Printing…') : t('Print KOT')}</button>}
                      </span>
                    ) : (
                      <span key={k.id} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${k.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : k.status === 'cooking' ? 'bg-amber-50 text-amber-700' : k.status === 'served' ? 'bg-slate-100 text-slate-500' : 'bg-orange-50 text-orange-700'}`}><ChefHat className="h-3 w-3" />KOT #{k.number} · {t(k.status === 'new' ? (kotMarks && k.printed_at ? 'Printed' : 'Sent to kitchen') : k.status === 'cooking' ? 'Cooking' : k.status === 'ready' ? 'Ready' : 'Served')}</span>
                    ))}
                  </div>
                )
              })()}
              {o.notes && <p className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"><StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />{o.notes}</p>}
              <div className="flex flex-wrap gap-2">
                {o.status === 'pending' && can('orders.create') && <Button size="sm" variant="soft" onClick={() => setStatus(o, 'accepted')}>{t('Accept')}</Button>}
                {['accepted', 'preparing', 'ready'].includes(o.status) && <Button size="sm" variant="soft" onClick={() => setStatus(o, 'served')}>{t('Mark served')}</Button>}
                {['served', 'ready', 'preparing', 'accepted'].includes(o.status) && !o.bill && <Button size="sm" onClick={() => bill(o)}>{t('Generate bill')}</Button>}
                {o.bill && (can('billing.manage') && o.bill.status !== 'paid'
                  ? <Link to={`/app/billing?pay=${o.bill.id}&from=orders`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent px-3.5 text-xs font-extrabold text-white shadow-card active:scale-95">{t('Collect {amount}', { amount: money(o.bill.grand_total) })}</Link>
                  : <Badge tone="blue">{t('Bill {no}', { no: o.bill.bill_no })} · {money(o.bill.grand_total)}</Badge>)}
                {!['paid', 'cancelled'].includes(o.status) && o.bill?.status !== 'paid' && can('orders.create') && <Link to={`/app/order/new?edit=${o.id}`}><Button size="sm" variant="secondary"><Pencil className="h-3.5 w-3.5" /> {t('Edit')}</Button></Link>}
                {['pending', 'accepted', 'preparing'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => { setWhy(''); setCancelFor(o) }}>{t('Cancel')}</Button>}
              </div>
            </Card>
            )
          })}
        </div>
      )}
      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title={t('Why is this order cancelled?')}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => <button key={r} type="button" onClick={() => setWhy(t(r))} className={`min-h-10 rounded-full px-3.5 text-[13px] font-semibold ring-1 transition active:scale-95 ${why === t(r) ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}>{t(r)}</button>)}
          </div>
          <Input label={t('Reason')} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={120} placeholder={t('Type the reason')} />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setCancelFor(null)}>{t('Keep order')}</Button>
            <Button variant="danger" disabled={why.trim().length < 3} onClick={confirmCancel}>{t('Cancel order')}</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
