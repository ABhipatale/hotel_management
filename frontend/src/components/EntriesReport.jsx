import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'
import { dt, money, tableText } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { useT } from '../i18n'
import { Badge, Button, Input, ListSkeleton, Modal, Table } from './ui'

const cents = (v) => Math.round((Number(v) || 0) * 100)

/** Owner only: every order / bill / payment in the period. Fix how a bill was paid (or its day), or delete the whole entry for good. */
export default function EntriesReport({ range }) {
  const t = useT()
  const toast = useToast()
  const { data, loading, reload } = useApi('/entries', { params: range })
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState('')
  const [cash, setCash] = useState('')
  const [upi, setUpi] = useState('')

  useEffect(() => {
    if (!edit) return
    const sum = (m) => edit.payments.filter((p) => p.method === m).reduce((a, p) => a + p.amount, 0)
    setDate(String(edit.created_at).slice(0, 10)); setCash(sum('cash') ? String(sum('cash')) : ''); setUpi(sum('upi') ? String(sum('upi')) : '')
  }, [edit])

  const save = async () => {
    setBusy(true)
    try {
      const payments = []
      if (cents(cash) > 0) payments.push({ method: 'cash', amount: Number(cash) })
      if (cents(upi) > 0) payments.push({ method: 'upi', amount: Number(upi) })
      await api.patch(`/entries/${edit.id}`, { date: date || undefined, payments: payments.length ? payments : undefined })
      toast.success(t('Saved')); setEdit(null); reload()
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try { await api.delete(`/entries/${del.id}`); toast.success(t('Entry deleted')); setDel(null); reload() } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  if (loading) return <ListSkeleton />
  const paidEdit = edit && edit.bill_status === 'paid'
  const mismatch = paidEdit && cents(cash) + cents(upi) !== cents(edit.total)

  return (
    <>
      <Table
        rows={data}
        empty={t('No data for this period')}
        columns={[
          { header: t('Order'), render: (r) => <span className="font-bold">{r.order_no}</span> },
          { header: t('Date'), render: (r) => dt(r.created_at) },
          { header: t('Table'), render: (r) => (r.table ? tableText(t, r.table) : r.type) },
          { header: t('Bill'), render: (r) => r.bill_no || '—' },
          { header: t('Total'), render: (r) => (r.total != null ? money(r.total) : '—') },
          { header: t('Paid by'), render: (r) => (r.payments.length ? r.payments.map((p) => `${p.method === 'upi' ? 'UPI' : t('Cash')} ${money(p.amount)}`).join(' + ') : <Badge tone="slate">{t(r.status)}</Badge>) },
          { render: (r) => r.bill_status === 'paid' && <Button size="sm" variant="secondary" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /> {t('Edit')}</Button> },
          { render: (r) => <Button size="sm" variant="danger" onClick={() => setDel(r)}><Trash2 className="h-4 w-4" /> {t('Delete')}</Button> },
        ]}
      />

      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('Edit entry')}>
        {edit && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{edit.order_no} · {edit.bill_no} · <b>{money(edit.total)}</b></p>
            <Input label={t('Date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('Cash')} type="number" min="0" step="0.01" inputMode="decimal" value={cash} onChange={(e) => { setCash(e.target.value); setUpi(cents(edit.total) - cents(e.target.value) > 0 ? ((cents(edit.total) - cents(e.target.value)) / 100).toFixed(2) : '') }} />
              <Input label={t('UPI / Online')} type="number" min="0" step="0.01" inputMode="decimal" value={upi} onChange={(e) => { setUpi(e.target.value); setCash(cents(edit.total) - cents(e.target.value) > 0 ? ((cents(edit.total) - cents(e.target.value)) / 100).toFixed(2) : '') }} />
            </div>
            {mismatch && <p className="text-xs font-medium text-accent-dark">{t('Cash + UPI must add up to the bill.')}</p>}
            <Button className="w-full" size="lg" loading={busy} disabled={mismatch || !paidEdit} onClick={save}>{t('Save')}</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!del} onClose={() => setDel(null)} title={t('Delete this entry?')}>
        {del && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('Order {no} with its bill and payments will be removed for good and will no longer count in any report. This cannot be undone.', { no: del.order_no })}</p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" size="lg" onClick={() => setDel(null)}>{t('Cancel')}</Button>
              <Button variant="danger" size="lg" loading={busy} onClick={remove}>{t('Delete')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
