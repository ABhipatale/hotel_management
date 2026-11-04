import { useState } from 'react'
import { GitBranch, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Button, Card, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'

export default function Branches() {
  const { hasFeature, reloadBranches } = useAuth()
  const toast = useToast()
  const ask = useConfirm()
  const { data, loading, reload } = useApi('/branches')
  const { data: staff } = useApi('/staff')
  const [edit, setEdit] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    const body = { ...edit, manager_id: edit.manager_id || null }
    try { edit.id ? await api.put(`/branches/${edit.id}`, body) : await api.post('/branches', body); toast.success('Saved'); setEdit(null); reload(); reloadBranches() } catch (x) { toast.error(x) }
  }
  const remove = async (b) => { if (await ask({ title: `Delete ${b.name}?`, message: 'Branches that already have orders cannot be deleted — deactivate them instead.', confirmText: 'Delete branch' })) { try { await api.delete(`/branches/${b.id}`); reload(); reloadBranches() } catch (e) { toast.error(e) } } }

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Branches" sub="Each branch has its own tables, orders, bills and expenses" actions={<Button onClick={() => setEdit({ name: '', address: '', manager_id: '' })}><Plus className="h-4 w-4" /> Add branch</Button>} />
      {!hasFeature('multi_branch') && <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Multi-branch support is available on the Premium plan. Upgrade from the Subscription page to add branches.</div>}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.map((b) => (
          <Card key={b.id}>
            <div className="flex items-center gap-2 font-semibold"><GitBranch className="h-4 w-4 text-brand" />{b.name}{b.is_default && <Badge tone="violet">default</Badge>}</div>
            <div className="mt-1 text-sm text-muted">{b.address || 'No address'}</div>
            <div className="mt-1 text-xs text-muted">Manager: {staff?.find((s) => s.id === b.manager_id)?.name || '—'}</div>
            <div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEdit({ ...b, manager_id: b.manager_id || '' })}>Edit</Button>{!b.is_default && <Button size="sm" variant="ghost" onClick={() => remove(b)}>Delete</Button>}</div>
          </Card>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit branch' : 'Add branch'}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Input label="Branch name" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Input label="Address" value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            <Select label="Branch manager" value={edit.manager_id} onChange={(e) => setEdit({ ...edit, manager_id: e.target.value })}><option value="">None</option>{staff?.filter((s) => ['manager', 'owner'].includes(s.role)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        )}
      </Modal>
    </>
  )
}
