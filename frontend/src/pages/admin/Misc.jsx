import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dt, money } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { Badge, Button, Card, Input, Modal, PageHeader, Select, Spinner, statusTone, Table, Textarea } from '../../components/ui'

export function AdminPayments() {
  const { data, loading } = useApi('/admin/payments')
  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Payment history" sub="All subscription payments across companies" />
      <Table rows={data.data} columns={[
        { header: 'Invoice', key: 'invoice_no' },
        { header: 'Company', render: (p) => p.company?.name },
        { header: 'Amount', render: (p) => money(p.amount) },
        { header: 'Gateway', render: (p) => p.gateway || '—' },
        { header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
        { header: 'Paid', render: (p) => dt(p.paid_at) },
      ]} />
    </>
  )
}

export function AdminTickets() {
  const toast = useToast()
  const { data, loading, reload } = useApi('/admin/tickets')
  const [t, setT] = useState(null)
  const save = async () => {
    try { await api.put(`/admin/tickets/${t.id}`, { reply: t.reply, status: t.status }); toast.success('Updated'); setT(null); reload() } catch (e) { toast.error(e) }
  }
  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Support requests" />
      <Table rows={data.data} columns={[
        { header: 'Company', render: (x) => x.company?.name },
        { header: 'Subject', key: 'subject' },
        { header: 'Status', render: (x) => <Badge tone={statusTone(x.status)}>{x.status.replace('_', ' ')}</Badge> },
        { header: 'Created', render: (x) => dt(x.created_at) },
        { header: '', render: (x) => <Button size="sm" variant="secondary" onClick={() => setT(x)}>Open</Button> },
      ]} />
      <Modal open={!!t} onClose={() => setT(null)} title={t?.subject}>
        {t && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{t.message}</p>
            <Textarea label="Reply" value={t.reply || ''} onChange={(e) => setT({ ...t, reply: e.target.value })} />
            <Select label="Status" value={t.status} onChange={(e) => setT({ ...t, status: e.target.value })}>
              {['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </Select>
            <Button className="w-full" onClick={save}>Save</Button>
          </div>
        )}
      </Modal>
    </>
  )
}

const SETTING_KEYS = [
  ['support_email', 'Support email'], ['support_phone', 'Support phone'], ['payment_gateway', 'Payment gateway (e.g. razorpay)'],
  ['gateway_key_id', 'Gateway key ID'], ['trial_policy', 'Trial policy note'], ['expiry_policy_note', 'Expiry policy note'],
]

export function AdminSettings() {
  const toast = useToast()
  const { data, loading } = useApi('/admin/settings')
  const [f, setF] = useState({})
  useEffect(() => { if (data) setF(data) }, [data])
  const save = async () => {
    try { await api.put('/admin/settings', { settings: f }); toast.success('Settings saved') } catch (e) { toast.error(e) }
  }
  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Platform settings" />
      <Card className="max-w-xl space-y-3">
        {SETTING_KEYS.map(([k, l]) => <Input key={k} label={l} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />)}
        <p className="text-xs text-muted">Never store gateway secret keys here — keep them in server environment variables.</p>
        <Button onClick={save}>Save settings</Button>
      </Card>
    </>
  )
}
