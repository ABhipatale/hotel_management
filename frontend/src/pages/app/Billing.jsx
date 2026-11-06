import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dt, money, today } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useT } from '../../i18n'
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

  // Arriving from "Place & bill": open the payment sheet for that bill right away
  useEffect(() => {
    const id = sp.get('pay')
    if (!id || !data) return
    const b = data.find((x) => String(x.id) === id)
    if (b) { setPaying(b); setSp({}, { replace: true }) }
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
            { header: t('For'), render: (b) => (b.order?.table?.number ? t('Table {n}', { n: b.order.table.number }) : b.order?.type === 'delivery' ? t('Delivery') : t('Walk-in')) },
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

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={t('Receipt')}>{receipt && <Receipt data={receipt} />}</Modal>
      <PayModal bill={paying} onClose={() => setPaying(null)} onPaid={(r) => { setPaying(null); reload(); setReceipt(r) }} />
    </>
  )
}

const METHODS = ['cash', 'upi', 'card', 'wallet']
const cents = (v) => Math.round((Number(v) || 0) * 100)

/**
 * Collect payment. The FULL bill amount is filled in automatically; the user can change the amount
 * or split it across several payment methods (e.g. part cash, part UPI). Paid must equal the bill.
 */
function PayModal({ bill, onClose, onPaid }) {
  const toast = useToast()
  const t = useT()
  const methodLabel = (m) => t(m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1))
  const total = bill ? Number(bill.grand_total) : 0
  const [lines, setLines] = useState([])
  const [tendered, setTendered] = useState('')
  const [busy, setBusy] = useState(false)

  // Every time a bill is opened: one cash line holding the whole amount
  useEffect(() => {
    if (bill) {
      setLines([{ method: 'cash', amount: total.toFixed(2), ref: '' }])
      setTendered('')
    }
  }, [bill?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!bill) return null

  const paid = lines.reduce((a, l) => a + cents(l.amount), 0)
  const remaining = cents(total) - paid // in paise
  const balanced = remaining === 0 && lines.length > 0 && lines.every((l) => cents(l.amount) > 0)
  const set = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const split = () => {
    const used = new Set(lines.map((l) => l.method))
    setLines((ls) => [...ls, { method: METHODS.find((m) => !used.has(m)) || 'upi', amount: (Math.max(remaining, 0) / 100).toFixed(2), ref: '' }])
  }
  const single = lines.length === 1 && lines[0].method === 'cash'
  const change = single && tendered ? Math.max(0, Number(tendered) - Number(lines[0].amount || 0)) : 0

  const pay = async () => {
    setBusy(true)
    try {
      const r = await api.post(`/bills/${bill.id}/pay`, { payments: lines.map((l) => ({ method: l.method, amount: Number(l.amount), reference: l.ref || undefined })) })
      toast.success(t('Payment received'))
      onPaid(r.data)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={t('Collect {amount}', { amount: money(total) })}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Bill', money(total), ''], ['Paying', money(paid / 100), ''], [remaining < 0 ? 'Extra' : 'Remaining', money(Math.abs(remaining) / 100), remaining === 0 ? 'text-brand' : 'text-accent-dark']].map(([l, v, c]) => (
            <div key={l} className="rounded-2xl bg-canvas px-2 py-2.5 ring-1 ring-line"><div className="text-[11px] font-semibold text-muted">{t(l)}</div><div className={`tabular text-sm font-extrabold ${c}`}>{v}</div></div>
          ))}
        </div>

        {lines.map((l, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-line p-3">
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map((m) => (
                <button key={m} type="button" onClick={() => set(i, { method: m })} className={`min-h-11 rounded-xl border text-sm font-bold transition ${l.method === m ? 'border-brand bg-brand-soft text-brand' : 'border-line text-slate-600'}`}>{methodLabel(m)}</button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1"><Input label={lines.length > 1 ? t('Amount · {method}', { method: methodLabel(l.method) }) : t('Amount')} type="number" min="0" step="0.01" inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} /></div>
              {lines.length > 1 && <button type="button" aria-label={t('Remove this payment')} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600 active:bg-rose-100"><Trash2 className="h-5 w-5" /></button>}
            </div>
            {l.method !== 'cash' && <Input label={t('Reference / transaction ID (optional)')} value={l.ref} onChange={(e) => set(i, { ref: e.target.value })} />}
          </div>
        ))}

        {single && (
          <>
            <Input label={t('Cash received (optional)')} type="number" min="0" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} hint={t('Enter what the customer handed over to see the change.')} />
            {change > 0 && <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{t('Return change:')} <b>{money(change)}</b></div>}
          </>
        )}

        {remaining > 0 && lines.length < 4 && <Button variant="secondary" className="w-full" onClick={split}><Plus className="h-4 w-4" /> {t('Split — add another payment ({amount} left)', { amount: money(remaining / 100) })}</Button>}
        {remaining !== 0 && <p className="text-center text-xs font-medium text-accent-dark">{remaining > 0 ? t('{amount} still to be collected', { amount: money(remaining / 100) }) : t('Amounts exceed the bill by {amount}', { amount: money(Math.abs(remaining) / 100) })}</p>}

        <Button variant="accent" className="w-full" size="lg" disabled={!balanced} loading={busy} onClick={pay}>{t('Confirm payment · {amount}', { amount: money(total) })}</Button>
      </div>
    </Modal>
  )
}
