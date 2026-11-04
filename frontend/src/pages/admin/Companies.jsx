import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { api, toFormData } from '../../lib/api'
import ImagePicker from '../../components/ImagePicker'
import { useApi } from '../../lib/useApi'
import { dateOnly } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Button, Input, Modal, PageHeader, Select, ListSkeleton, statusTone, Table } from '../../components/ui'

export default function Companies() {
  const toast = useToast()
  const ask = useConfirm()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const { data, loading, reload } = useApi('/admin/companies', { params: { search, status } })
  const { data: plans } = useApi('/admin/plans')
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState(null)

  const act = async (fn, msg) => {
    try { await fn(); toast.success(msg); reload(); setDetail(null) } catch (e) { toast.error(e) }
  }

  return (
    <>
      <PageHeader title="Companies" sub="Every tenant on the platform" actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New company</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, company ID" className="min-h-12 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm w-full pl-11" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-12 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm">
          <option value="">All statuses</option>
          {['trial', 'active', 'inactive', 'suspended'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {loading ? <ListSkeleton /> : (
        <Table
          rows={data?.data}
          columns={[
            { header: 'Company', render: (c) => (
              <div className="flex items-center gap-3">
                {c.icon_url || c.logo_url ? <img src={c.icon_url || c.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" /> : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft font-bold text-brand">{c.name[0]}</div>}
                <div><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{c.uid} · {c.email}</div></div>
              </div>
            ) },
            { header: 'Plan', render: (c) => c.current_subscription?.plan?.name || '—' },
            { header: 'Status', render: (c) => <Badge tone={c.deleted_at ? 'red' : statusTone(c.status)}>{c.deleted_at ? 'deleted' : c.status}</Badge> },
            { header: 'Expires', render: (c) => dateOnly(c.current_subscription?.ends_at) },
            { header: '', className: 'text-right', render: (c) => <Button size="sm" variant="secondary" onClick={() => setDetail(c)}>Manage</Button> },
          ]}
        />
      )}

      <AddCompany open={adding} onClose={() => setAdding(false)} plans={plans} onDone={() => { setAdding(false); reload() }} />

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && (
          <div className="space-y-4">
            <div className="text-sm text-muted">{detail.uid} · {detail.phone} · {detail.city}</div>
            <div className="grid grid-cols-2 gap-2">
              {detail.status !== 'active' && <Button variant="soft" onClick={() => act(() => api.patch(`/admin/companies/${detail.id}/status`, { status: 'active' }), 'Activated')}>Activate</Button>}
              {detail.status !== 'inactive' && <Button variant="secondary" onClick={() => act(() => api.patch(`/admin/companies/${detail.id}/status`, { status: 'inactive' }), 'Deactivated')}>Deactivate</Button>}
              {detail.status !== 'suspended' && <Button variant="secondary" onClick={() => act(() => api.patch(`/admin/companies/${detail.id}/status`, { status: 'suspended' }), 'Suspended')}>Suspend</Button>}
              <Button variant="danger" onClick={async () => (await ask({ title: 'Delete company?', message: `${detail.name} will be removed from the platform. Its data is kept according to the retention policy.`, confirmText: 'Delete company' })) && act(() => api.delete(`/admin/companies/${detail.id}`), 'Deleted')}>Delete</Button>
            </div>
            <BrandingEditor company={detail} onDone={(c) => { setDetail(c); reload() }} />
            <AssignPlan company={detail} plans={plans} onDone={() => { toast.success('Subscription updated'); reload(); setDetail(null) }} />
          </div>
        )}
      </Modal>
    </>
  )
}

/** Super admin: set a company's logo and app icon on its behalf. */
function BrandingEditor({ company, onDone }) {
  const toast = useToast()
  const [logo, setLogo] = useState(null)
  const [icon, setIcon] = useState(null)
  const [removeIcon, setRemoveIcon] = useState(false)
  const [busy, setBusy] = useState(false)
  const dirty = logo || icon || removeIcon

  const save = async () => {
    setBusy(true)
    try {
      const { data } = await api.post(`/admin/companies/${company.id}/branding`, toFormData({ logo, icon, remove_icon: removeIcon || undefined }))
      toast.success('Branding updated')
      setLogo(null); setIcon(null); setRemoveIcon(false)
      onDone({ ...company, ...data })
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5 rounded-2xl bg-slate-50 p-4">
      <div className="text-sm font-semibold">Logo &amp; app icon</div>
      <ImagePicker label="Company logo" current={company.logo_url} file={logo} onChange={setLogo} rounded="rounded-2xl" fit="object-contain bg-white" />
      <ImagePicker label="App icon (square, 512 x 512 recommended)" current={removeIcon ? null : company.icon_url} file={icon} onChange={(x) => { setIcon(x); setRemoveIcon(false) }} onRemove={company.icon_url ? () => setRemoveIcon(true) : undefined} />
      <Button className="w-full" disabled={!dirty} loading={busy} onClick={save}>Save branding</Button>
    </div>
  )
}

function AssignPlan({ company, plans, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ plan_id: plans?.[0]?.id || '', billing_cycle: 'monthly', trial: '0' })
  const go = async () => {
    try { await api.post(`/admin/companies/${company.id}/subscription`, { ...f, trial: f.trial === '1' }); onDone() } catch (e) { toast.error(e) }
  }
  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3">
      <div className="text-sm font-medium">Assign subscription</div>
      <Select value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })}>{plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <div className="grid grid-cols-2 gap-2">
        <Select value={f.billing_cycle} onChange={(e) => setF({ ...f, billing_cycle: e.target.value })}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select>
        <Select value={f.trial} onChange={(e) => setF({ ...f, trial: e.target.value })}><option value="0">Paid / active</option><option value="1">Free trial</option></Select>
      </div>
      <Button className="w-full" onClick={go}>Apply</Button>
    </div>
  )
}

function AddCompany({ open, onClose, plans, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ company_name: '', owner_name: '', phone: '', email: '', password: '', city: '', plan_id: '' })
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await api.post('/admin/companies', { ...f, plan_id: f.plan_id || undefined }); toast.success('Company created'); onDone() } catch (x) { toast.error(x) } finally { setBusy(false) }
  }
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open={open} onClose={onClose} title="Register company">
      <form onSubmit={submit} className="space-y-3">
        <Input label="Company name" required value={f.company_name} onChange={s('company_name')} />
        <Input label="Owner name" required value={f.owner_name} onChange={s('owner_name')} />
        <Input label="Mobile" required value={f.phone} onChange={s('phone')} />
        <Input label="Owner email" type="email" required value={f.email} onChange={s('email')} />
        <Input label="Initial password" type="password" required value={f.password} onChange={s('password')} hint="Min 8 chars, letters + numbers" />
        <Input label="City" value={f.city} onChange={s('city')} />
        <Select label="Plan (trial)" value={f.plan_id} onChange={s('plan_id')}><option value="">Lowest plan</option>{plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Button type="submit" loading={busy} className="w-full">Create</Button>
      </form>
    </Modal>
  )
}
