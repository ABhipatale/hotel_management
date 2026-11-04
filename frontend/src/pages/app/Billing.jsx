import { useState } from 'react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dt, money, today } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import Receipt from '../../components/Receipt'
import { Badge, Button, Chips, Input, Modal, PageHeader, Spinner, statusTone, Table } from '../../components/ui'

export default function Billing() {
  const toast = useToast()
  const [status, setStatus] = useState('unpaid')
  const { data, loading, reload } = useApi('/bills', { params: { status: status || undefined, date: status === 'paid' ? today() : undefined }, poll: 10000 })
  const [receipt, setReceipt] = useState(null)
  const [paying, setPaying] = useState(null)

  const open = async (b) => {
    try { setReceipt((await api.get(`/bills/${b.id}`)).data) } catch (e) { toast.error(e) }
  }

  return (
    <>
      <PageHeader title="Billing" sub="Collect payments and print bills" />
      <Chips items={[['unpaid', 'Unpaid'], ['paid', 'Paid today'], ['all', 'All']]} value={status || 'all'} onChange={(k) => setStatus(k === 'all' ? '' : k)} />
      {loading ? <Spinner /> : (
        <Table
          empty="No bills here"
          rows={data}
          columns={[
            { header: 'Bill', key: 'bill_no' },
            { header: 'Table', render: (b) => b.order?.table?.number ? `T${b.order.table.number}` : '—' },
            { header: 'Time', render: (b) => dt(b.created_at) },
            { header: 'Total', render: (b) => <b>{money(b.grand_total)}</b> },
            { header: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
            { header: '', className: 'text-right', render: (b) => (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => open(b)}>Receipt</Button>
                {b.status === 'unpaid' && <Button size="sm" onClick={() => setPaying(b)}>Collect</Button>}
              </div>
            ) },
          ]}
        />
      )}

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Receipt">{receipt && <Receipt data={receipt} />}</Modal>
      <PayModal bill={paying} onClose={() => setPaying(null)} onPaid={(r) => { setPaying(null); reload(); setReceipt(r) }} />
    </>
  )
}

function PayModal({ bill, onClose, onPaid }) {
  const toast = useToast()
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [tendered, setTendered] = useState('')
  const [busy, setBusy] = useState(false)
  if (!bill) return null
  const total = Number(bill.grand_total)
  const change = method === 'cash' && tendered ? Math.max(0, Number(tendered) - total) : 0

  const pay = async () => {
    setBusy(true)
    try {
      const r = await api.post(`/bills/${bill.id}/pay`, { payments: [{ method, amount: total, reference: ref || undefined }] })
      toast.success('Payment received')
      onPaid(r.data)
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={`Collect ${money(total)}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">{['cash', 'upi', 'card', 'wallet'].map((m) => <button key={m} onClick={() => setMethod(m)} className={`rounded-xl border py-2.5 text-sm font-medium capitalize ${method === m ? 'border-brand bg-brand-soft text-brand' : 'border-line'}`}>{m}</button>)}</div>
        {method === 'cash' ? (
          <>
            <Input label="Cash received" type="number" min={total} value={tendered} onChange={(e) => setTendered(e.target.value)} />
            {change > 0 && <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Return change: <b>{money(change)}</b></div>}
          </>
        ) : <Input label="Reference / transaction ID (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />}
        <Button className="w-full" size="lg" loading={busy} onClick={pay}>Confirm payment</Button>
      </div>
    </Modal>
  )
}
