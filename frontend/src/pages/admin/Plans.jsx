import { useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { Badge, Button, Card, Input, Modal, PageHeader, Spinner } from '../../components/ui'

const FEATURES = ['qr', 'thermal', 'reports', 'advanced_reports', 'inventory', 'expenses', 'pnl', 'multi_branch', 'advanced_permissions']
const BLANK = { name: '', slug: '', price_monthly: 0, price_yearly: 0, max_staff: '', max_tables: '', max_branches: 1, trial_days: 14, features: [], is_active: true }

export default function Plans() {
  const toast = useToast()
  const { data, loading, reload } = useApi('/admin/plans')
  const [edit, setEdit] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    const body = { ...edit, max_staff: edit.max_staff || null, max_tables: edit.max_tables || null }
    try {
      edit.id ? await api.put(`/admin/plans/${edit.id}`, body) : await api.post('/admin/plans', body)
      toast.success('Plan saved'); setEdit(null); reload()
    } catch (x) { toast.error(x) }
  }
  const toggle = (f) => setEdit({ ...edit, features: edit.features.includes(f) ? edit.features.filter((x) => x !== f) : [...edit.features, f] })
  const s = (k) => (e) => setEdit({ ...edit, [k]: e.target.value })

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Subscription plans" sub="Limits and features each plan unlocks" actions={<Button onClick={() => setEdit(BLANK)}><Plus className="h-4 w-4" /> New plan</Button>} />
      <div className="grid gap-4 md:grid-cols-3">
        {data.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{p.name}</h3>{!p.is_active && <Badge tone="red">hidden</Badge>}</div>
            <div className="mt-1 text-2xl font-semibold">{money(p.price_monthly)}<span className="text-sm font-normal text-muted"> /month</span></div>
            <div className="text-xs text-muted">{money(p.price_yearly)} / year · {p.trial_days}-day trial</div>
            <ul className="my-4 flex-1 space-y-1 text-sm">
              <li>{p.max_staff ?? 'Unlimited'} staff accounts</li><li>{p.max_branches} branch(es)</li>
            </ul>
            <div className="mb-4 flex flex-wrap gap-1">{(p.features || []).map((f) => <Badge key={f} tone="violet">{f.replace('_', ' ')}</Badge>)}</div>
            <Button variant="secondary" onClick={() => setEdit({ ...p, max_staff: p.max_staff ?? '', max_tables: p.max_tables ?? '' })}>Edit</Button>
          </Card>
        ))}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit plan' : 'New plan'} wide>
        {edit && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" required value={edit.name} onChange={s('name')} />
            <Input label="Slug" required value={edit.slug} onChange={s('slug')} />
            <Input label="Monthly price" type="number" min="0" required value={edit.price_monthly} onChange={s('price_monthly')} />
            <Input label="Yearly price" type="number" min="0" required value={edit.price_yearly} onChange={s('price_yearly')} />
            <Input label="Max staff" type="number" min="1" placeholder="Unlimited" value={edit.max_staff} onChange={s('max_staff')} />
            <Input label="Max branches" type="number" min="1" required value={edit.max_branches} onChange={s('max_branches')} />
            <Input label="Trial days" type="number" min="0" required value={edit.trial_days} onChange={s('trial_days')} />
            <div className="sm:col-span-2">
              <div className="mb-1 text-xs font-medium text-muted">Features</div>
              <div className="flex flex-wrap gap-2">
                {FEATURES.map((f) => (
                  <button type="button" key={f} onClick={() => toggle(f)} className={`rounded-full border px-3 py-1 text-xs ${edit.features.includes(f) ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted'}`}>{f.replace('_', ' ')}</button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Available for new signups</label>
            <Button type="submit" className="sm:col-span-2">Save plan</Button>
          </form>
        )}
      </Modal>
    </>
  )
}
