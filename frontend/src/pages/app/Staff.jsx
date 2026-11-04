import { useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dt } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Button, Input, Modal, PageHeader, Select, Spinner, Table } from '../../components/ui'

const ROLES = ['waiter']
const BLANK = { name: '', email: '', phone: '', password: '', role: 'waiter' }

export default function Staff() {
  const toast = useToast()
  const ask = useConfirm()
  const { data, loading, reload } = useApi('/staff')
  const [edit, setEdit] = useState(null)
  const [log, setLog] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    const body = { ...edit }
    if (!body.password) delete body.password
    try {
      edit.id ? await api.put(`/staff/${edit.id}`, body) : await api.post('/staff', body)
      toast.success('Saved'); setEdit(null); reload()
    } catch (x) { toast.error(x) }
  }
  const toggle = async (u) => { try { await api.put(`/staff/${u.id}`, { is_active: !u.is_active }); reload() } catch (e) { toast.error(e) } }
  const remove = async (u) => { if (await ask({ title: `Delete ${u.name}?`, message: 'They will no longer be able to sign in.', confirmText: 'Delete staff' })) { try { await api.delete(`/staff/${u.id}`); reload() } catch (e) { toast.error(e) } } }
  const activity = async (u) => { try { setLog({ user: u, rows: (await api.get(`/staff/${u.id}/activity`)).data }) } catch (e) { toast.error(e) } }
  const s = (k) => (e) => setEdit({ ...edit, [k]: e.target.value })

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Staff" sub="Accounts that can sign in to your company" actions={<Button onClick={() => setEdit(BLANK)}><Plus className="h-4 w-4" /> Add staff</Button>} />
      <Table rows={data} columns={[
        { header: 'Name', render: (u) => <div><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></div> },
        { header: 'Role', render: (u) => <Badge tone={u.role === 'owner' ? 'violet' : 'blue'}>{u.role}</Badge> },
        { header: 'Last login', render: (u) => dt(u.last_login_at) },
        { header: 'Status', render: (u) => <Badge tone={u.is_active ? 'green' : 'slate'}>{u.is_active ? 'active' : 'disabled'}</Badge> },
        { header: '', className: 'text-right', render: (u) => u.role === 'owner' ? null : (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => activity(u)}>Activity</Button>
            <Button size="sm" variant="secondary" onClick={() => setEdit({ ...u, password: '' })}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.is_active ? 'Disable' : 'Enable'}</Button>
            <Button size="sm" variant="ghost" onClick={() => remove(u)}>Delete</Button>
          </div>
        ) },
      ]} />

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit staff' : 'Add staff'}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Input label="Full name" required value={edit.name} onChange={s('name')} />
            <Input label="Login email" type="email" required value={edit.email} onChange={s('email')} />
            <Input label="Mobile" value={edit.phone || ''} onChange={s('phone')} />
            <Input label={edit.id ? 'New password (leave blank to keep)' : 'Password'} type="password" required={!edit.id} value={edit.password} onChange={s('password')} hint="Min 8 characters with letters and numbers" autoComplete="new-password" />
            <Select label="Role" value={edit.role} onChange={s('role')}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        )}
      </Modal>

      <Modal open={!!log} onClose={() => setLog(null)} title={`Activity · ${log?.user.name}`} wide>
        {log && (log.rows.length ? log.rows.map((r) => <div key={r.id} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{r.action}</span><span className="text-xs text-muted">{dt(r.created_at)}</span></div>) : <p className="py-8 text-center text-sm text-muted">No recorded activity</p>)}
      </Modal>
    </>
  )
}
