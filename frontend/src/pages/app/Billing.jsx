import { useEffect, useRef, useState } from 'react'
import { Banknote, Smartphone } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { tableText, dt, money, today } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useT } from '../../i18n'
import { useApproval } from '../../context/ApprovalContext'
import Receipt from '../../components/Receipt'
import { Badge, Button, Chips, Input, Modal, PageHeader, ListSkeleton, statusTone, Table } from '../../components/ui'

export default function Billing() {
  const toast = useToast()
  const t = useT()
  const [status, setStatus] = useState('unpaid')
  const { data, loading, reload } = useApi('/bills', { params: { status: status || undefined, date: status === 'paid' ? today() : undefined }, poll: 10000 })
  const [receipt, setReceipt] = useState(null)
  const [paying, setPaying] = useState(null)
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  // Where to return after the payment, when it was started from the order screens ("Place & bill", Collect on an order).
  // Collect pressed on this Billing page itself leaves this empty: it stays here, as before.
  const back = useRef(null)

  // Arriving from "Place & bill": open the payment sheet for that bill right away
  useEffect(() => {
    const id = sp.get('pay')
    if (!id || !data) return
    const b = data.find((x) => String(x.id) === id)
    if (b) {
      back.current = sp.get('from') === 'new' ? '/app/order/new' : sp.get('from') === 'orders' ? '/app/orders' : null
      setPaying(b); setSp({}, { replace: true })
    }
  }, [sp, data, setSp])

  const open = async (b) => {
    try { setReceipt((await api.get(`/bills/${b.id}`)).data) } catch (e) { toast.error(e) }
  }

  return (
    <>
      <PageHeader title={t('Billing')} sub={t('Collect payments and print bills')} />
      <Chips items={[['unpaid', t('Unpaid')], ['paid', t('Paid today')], ['all', t('All')]]} value={status || 'all'} onChange={(k) => setStatus(k === 'all' ? '' : k)} />
      {loading ? <ListSkeleton /> : (
        <Table
          empty={t('No bills here')}
          rows={data}
          columns={[
            { header: t('Bill'), key: 'bill_no' },
            { header: t('For'), render: (b) => (b.order?.table?.number ? tableText(t, b.order.table.number) : b.order?.type === 'delivery' ? t('Delivery') : t('Walk-in')) },
            { header: t('Time'), render: (b) => dt(b.created_at) },
            { header: t('Total'), render: (b) => <b>{money(b.grand_total)}</b> },
            { header: t('Status'), render: (b) => <Badge tone={statusTone(b.status)}>{t(b.status[0].toUpperCase() + b.status.slice(1))}</Badge> },
            { header: '', className: 'text-right', render: (b) => (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => open(b)}>{t('Receipt')}</Button>
                {b.status === 'unpaid' && <Button variant="accent" size="sm" onClick={() => setPaying(b)}>{t('Collect')}</Button>}
              </div>
            ) },
          ]}
        />
      )}

      <Modal open={!!receipt} onClose={() => { setReceipt(null); if (back.current) { const to = back.current; back.current = null; nav(to) } }} title={t('Receipt')}>{receipt && <Receipt data={receipt} />}</Modal>
      <PayModal bill={paying} onBill={setPaying} onClose={() => { setPaying(null); back.current = null }} onPaid={(r) => { setPaying(null); reload(); setReceipt(r) }} />
    </>
  )
}

const cents = (v) => Math.round((Number(v) || 0) * 100)
const fix = (paise) => (Math.max(paise, 0) / 100).toFixed(2)

/**
 * Collect payment: only Cash and UPI. One customer may pay part in cash and part online —
 * type either amount and the other fills in with what is left, so the two always add up to the bill.
 */
function PayModal({ bill, onBill, onClose, onPaid }) {
  const toast = useToast()
  const approve = useApproval()
  const t = useT()
  const total = bill ? Number(bill.grand_total) : 0
  const [cash, setCash] = useState('')
  const [upi, setUpi] = useState('')
  const [ref, setRef] = useState('')
  const [disc, setDisc] = useState('')
  const [discBusy, setDiscBusy] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // Every time a bill is opened: the whole amount in cash (change it with one tap)
  useEffect(() => {
    if (bill) { setCash(Number(bill.grand_total).toFixed(2)); setUpi(''); setRef(''); setDisc(''); setName(bill.order?.customer_name || '') }
  }, [bill?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The total changed (a discount was applied): the whole amount in cash again
  useEffect(() => {
    if (bill) { setCash(Number(bill.grand_total).toFixed(2)); setUpi('') }
  }, [bill?.grand_total]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!bill) return null

  const due = cents(total)
  const paid = cents(cash) + cents(upi)
  const remaining = due - paid // paise
  const balanced = remaining === 0 && paid > 0
  const onCash = (v) => { setCash(v); setUpi(due - cents(v) > 0 ? fix(due - cents(v)) : '') }
  const onUpi = (v) => { setUpi(v); setCash(due - cents(v) > 0 ? fix(due - cents(v)) : '') }
  const preset = (c, u) => { setCash(c ? fix(c) : ''); setUpi(u ? fix(u) : '') }

  // Discount on the whole bill: the server works out the new total (a big one asks for the owner's PIN), then the amounts are re-filled
  const applyDiscount = async () => {
    setDiscBusy(true)
    try {
      const r = await approve((pin) => api.post(`/bills/${bill.id}/discount`, { amount: Number(disc) || 0 }, pin ? { headers: { 'X-Approval-Pin': pin } } : undefined))
      onBill({ ...bill, ...r.data })
      toast.success(Number(disc) > 0 ? t('Discount applied') : t('Discount removed'))
    } catch (e) { if (!e.cancelled) toast.error(e) } finally { setDiscBusy(false) }
  }
  const itemDisc = Number(bill.item_discount || 0)
  const extraDisc = Math.max(0, Number(bill.discount || 0) - itemDisc)

  const pay = async () => {
    setBusy(true)
    try {
      const payments = []
      if (cents(cash) > 0) payments.push({ method: 'cash', amount: Number(cash) })
      if (cents(upi) > 0) payments.push({ method: 'upi', amount: Number(upi), reference: ref || undefined })
      const r = await api.post(`/bills/${bill.id}/pay`, { payments, customer_name: name.trim() || undefined })
      toast.success(t('Payment received'))
      onPaid(r.data)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  const chip = (label, on, active) => (
    <button type="button" onClick={on} className={`min-h-11 flex-1 rounded-xl border px-2 text-sm font-bold transition active:scale-95 ${active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-white text-slate-600'}`}>{label}</button>
  )

  return (
    <Modal open onClose={onClose} title={t('Collect {amount}', { amount: money(total) })} footer={
      <Button variant="accent" className="w-full" size="lg" disabled={!balanced} loading={busy} onClick={pay}>{t('Confirm payment · {amount}', { amount: money(total) })}</Button>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Bill', money(total), ''], ['Paying', money(paid / 100), ''], [remaining < 0 ? 'Extra' : 'Remaining', money(Math.abs(remaining) / 100), remaining === 0 ? 'text-brand' : 'text-accent-dark']].map(([l, v, c]) => (
            <div key={l} className="rounded-2xl bg-canvas px-2 py-2.5 ring-1 ring-line"><div className="text-[11px] font-semibold text-muted">{t(l)}</div><div className={`tabular text-sm font-extrabold ${c}`}>{v}</div></div>
          ))}
        </div>

        <div className="flex gap-2">
          {chip(t('Full cash'), () => preset(due, 0), cents(cash) === due)}
          {chip(t('Full UPI'), () => preset(0, due), cents(upi) === due)}
          {chip(t('Half & half'), () => preset(Math.floor(due / 2), due - Math.floor(due / 2)), cents(cash) > 0 && cents(upi) > 0)}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-2xl border p-3 transition ${cents(cash) > 0 ? 'border-emerald-300 bg-emerald-50/60' : 'border-line'}`}>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-emerald-700"><Banknote className="h-4 w-4" />{t('Cash')}</div>
            <input aria-label={t('Cash')} type="number" min="0" step="0.01" inputMode="decimal" value={cash} placeholder="0" onChange={(e) => onCash(e.target.value)} onFocus={(e) => e.target.select()} className="tabular min-h-12 w-full rounded-xl border border-line bg-white px-3 text-xl font-extrabold outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
          </div>
          <div className={`rounded-2xl border p-3 transition ${cents(upi) > 0 ? 'border-violet-300 bg-violet-50/60' : 'border-line'}`}>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-violet-700"><Smartphone className="h-4 w-4" />{t('UPI / Online')}</div>
            <input aria-label={t('UPI / Online')} type="number" min="0" step="0.01" inputMode="decimal" value={upi} placeholder="0" onChange={(e) => onUpi(e.target.value)} onFocus={(e) => e.target.select()} className="tabular min-h-12 w-full rounded-xl border border-line bg-white px-3 text-xl font-extrabold outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input label={extraDisc > 0 ? t('Discount (₹) · {amount} given', { amount: money(extraDisc) }) : t('Discount (₹)')} type="number" min="0" step="0.01" inputMode="decimal" value={disc} placeholder="0" onChange={(e) => setDisc(e.target.value)} />
          </div>
          <Button type="button" variant="secondary" size="lg" loading={discBusy} disabled={disc === '' && extraDisc === 0} onClick={applyDiscount}>{t('Apply')}</Button>
        </div>
        {bill.order && bill.order.type !== 'dine_in' && <Input label={t('Customer name (optional)')} placeholder={t('Name for the takeaway / parcel')} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
        {cents(upi) > 0 && <Input label={t('UPI reference / transaction ID (optional)')} value={ref} onChange={(e) => setRef(e.target.value)} />}

        {remaining !== 0 && <p className="text-center text-xs font-medium text-accent-dark">{remaining > 0 ? t('{amount} still to be collected', { amount: money(remaining / 100) }) : t('Amounts exceed the bill by {amount}', { amount: money(Math.abs(remaining) / 100) })}</p>}

      </div>
    </Modal>
  )
}
