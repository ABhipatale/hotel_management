import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { api, toFormData } from '../../lib/api'
import ImagePicker from '../../components/ImagePicker'
import { useApi } from '../../lib/useApi'
import { dateOnly } from '../../lib/format'
import { useT } from '../../i18n'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Badge, Button, Input, Modal, PageHeader, Select, ListSkeleton, statusTone, Switch, Table } from '../../components/ui'

export default function Companies() {
  const toast = useToast()
  const tr = useT()
  const ask = useConfirm()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const { data, loading, reload } = useApi('/admin/companies', { params: { search, status } })
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
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Search name, email, company ID')} className="min-h-12 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm w-full pl-11" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-12 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm">
          <option value="">{tr('All statuses')}</option>
          {['active', 'inactive', 'suspended'].map((s) => <option key={s} value={s}>{tr(s)}</option>)}
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
            { header: 'Subscription', render: (c) => (c.current_subscription ? <span className="capitalize">{tr(c.current_subscription.billing_cycle)}</span> : <Badge tone="amber">Awaiting purchase</Badge>) },
            { header: 'Status', render: (c) => <Badge tone={c.deleted_at ? 'red' : statusTone(c.status)}>{c.deleted_at ? 'deleted' : c.status}</Badge> },
            { header: 'Expires', render: (c) => dateOnly(c.current_subscription?.ends_at) },
            { header: '', className: 'text-right', render: (c) => <Button size="sm" variant="secondary" onClick={() => setDetail(c)}>Manage</Button> },
          ]}
        />
      )}

      <AddCompany open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name} full>
        {detail && (
          <div className="space-y-4">
            <div className="text-sm text-muted">{detail.uid} · {detail.phone} · {detail.city}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {detail.status !== 'active' && <Button variant="soft" onClick={() => act(() => api.patch(`/admin/companies/${detail.id}/status`, { status: 'active' }), 'Activated')}>Activate</Button>}
              {detail.status !== 'inactive' && <Button variant="secondary" onClick={() => act(() => api.patch(`/admin/companies/${detail.id}/status`, { status: 'inactive' }), 'Deactivated')}>Deactivate</Button>}
              {detail.status !== 'suspended' && <Button variant="secondary" onClick={() => act(() => api.patch(`/admin/companies/${detail.id}/status`, { status: 'suspended' }), 'Suspended')}>Suspend</Button>}
              <Button variant="danger" onClick={async () => (await ask({ title: 'Delete company?', message: tr('{name} will be removed from the platform. Its data is kept according to the retention policy.', { name: detail.name }), confirmText: 'Delete company' })) && act(() => api.delete(`/admin/companies/${detail.id}`), 'Deleted')}>Delete</Button>
            </div>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <CompanyDetailsEditor key={detail.id} company={detail} onDone={(c) => { setDetail(c); reload() }} />
              <div className="space-y-4">
                <BrandingEditor company={detail} onDone={(c) => { setDetail(c); reload() }} />
                <RenewSubscription company={detail} onDone={() => { toast.success('Subscription updated'); reload(); setDetail(null) }} />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

/** GST on/off + number. When off, every GST field/calculation is disabled for that company. */
function GstFields({ enabled, number, onEnabled, onNumber }) {
  return (
    <div className="space-y-3">
      <Switch label="Charge GST" checked={enabled} onChange={onEnabled} hint={enabled ? 'GST is added to bills and shown on receipts.' : 'No GST anywhere: GST number, dish GST % and bill tax are all switched off.'} />
      <Input label="GST number" value={enabled ? number : ''} onChange={(e) => onNumber(e.target.value)} disabled={!enabled} placeholder={enabled ? 'e.g. 27ABCDE1234F1Z5' : 'GST is off'} />
    </div>
  )
}

function LangSelect({ value, onChange }) {
  return (
    <Select label="Default language" value={value} onChange={(e) => onChange(e.target.value)} hint="The language this company's app opens in. Each user can still switch it themselves.">
      <option value="en">English</option><option value="hi">हिन्दी (Hindi)</option><option value="mr">मराठी (Marathi)</option>
    </Select>
  )
}

function QrSwitch({ checked, onChange }) {
  return <Switch label="QR table ordering" checked={checked} onChange={onChange} hint={checked ? 'Tables get QR codes; customers can scan and order from their phone.' : 'QR codes and the customer QR menu are switched off for this company.'} />
}

/** Super admin: edit company details, including the GST switch. */
function CompanyDetailsEditor({ company, onDone }) {
  const toast = useToast()
  const tr = useT()
  const [f, setF] = useState({
    name: company.name || '', phone: company.phone || '', email: company.email || '', address: company.address || '', city: company.city || '',
    gst_enabled: company.gst_enabled !== false, gst_number: company.gst_number || '', qr_enabled: company.qr_enabled !== false, default_language: company.default_language || 'en',
  })
  const [busy, setBusy] = useState(false)
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setBusy(true)
    try {
      const { data } = await api.put(`/admin/companies/${company.id}`, { ...f, gst_number: f.gst_enabled ? f.gst_number || null : undefined })
      toast.success('Company updated')
      onDone({ ...company, ...data })
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4 rounded-2xl bg-canvas p-4 ring-1 ring-line">
      <div className="text-sm font-semibold">{tr('Company details')}</div>
      <Input label="Company name" value={f.name} onChange={s('name')} />
      <div className="grid grid-cols-2 gap-3"><Input label="Phone" value={f.phone} onChange={s('phone')} /><Input label="City" value={f.city} onChange={s('city')} /></div>
      <Input label="Email" type="email" value={f.email} onChange={s('email')} />
      <Input label="Address" value={f.address} onChange={s('address')} />
      <GstFields enabled={f.gst_enabled} number={f.gst_number} onEnabled={(v) => setF({ ...f, gst_enabled: v })} onNumber={(v) => setF({ ...f, gst_number: v })} />
      <QrSwitch checked={f.qr_enabled} onChange={(v) => setF({ ...f, qr_enabled: v })} />
      <LangSelect value={f.default_language} onChange={(v) => setF({ ...f, default_language: v })} />
      <Button className="w-full" loading={busy} onClick={save}>Save details</Button>
    </div>
  )
}

/** Super admin: set a company's logo and app icon on its behalf. */
function BrandingEditor({ company, onDone }) {
  const toast = useToast()
  const tr = useT()
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
      <div className="text-sm font-semibold">{tr('Logo & app icon')}</div>
      <ImagePicker label="Company logo" current={company.logo_url} file={logo} onChange={setLogo} rounded="rounded-2xl" fit="object-contain bg-white" />
      <ImagePicker label="App icon (square, 512 x 512 recommended)" current={removeIcon ? null : company.icon_url} file={icon} onChange={(x) => { setIcon(x); setRemoveIcon(false) }} onRemove={company.icon_url ? () => setRemoveIcon(true) : undefined} />
      <Button className="w-full" disabled={!dirty} loading={busy} onClick={save}>Save branding</Button>
    </div>
  )
}

function RenewSubscription({ company, onDone }) {
  const toast = useToast()
  const tr = useT()
  const [cycle, setCycle] = useState('monthly')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await api.post(`/admin/companies/${company.id}/subscription`, { billing_cycle: cycle }); onDone() } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
      <div className="text-sm font-semibold">{tr('Renew subscription')}</div>
      <Select aria-label={tr('Billing period')} value={cycle} onChange={(e) => setCycle(e.target.value)}><option value="monthly">{tr('Monthly')}</option><option value="yearly">{tr('Yearly')}</option></Select>
      <p className="text-xs text-muted">{tr("Extends from the current end date and records the payment at today's price.")}</p>
      <Button className="w-full" loading={busy} onClick={go}>Renew</Button>
    </div>
  )
}

function AddCompany({ open, onClose, onDone }) {
  const toast = useToast()
  const tr = useT()
  const [f, setF] = useState({ company_name: '', owner_name: '', phone: '', email: '', password: '', city: '', gst_enabled: true, qr_enabled: true, default_language: 'en', gst_number: '', billing_cycle: '' })
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await api.post('/admin/companies', f); toast.success('Company created'); onDone() } catch (x) { toast.error(x) } finally { setBusy(false) }
  }
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open={open} onClose={onClose} title="Add company">
      <form onSubmit={submit} className="space-y-3">
        <Input label="Company name" required value={f.company_name} onChange={s('company_name')} />
        <Input label="Owner name" required value={f.owner_name} onChange={s('owner_name')} />
        <Input label="Mobile" required value={f.phone} onChange={s('phone')} />
        <Input label="Owner email" type="email" required value={f.email} onChange={s('email')} />
        <Input label="Initial password" type="password" required value={f.password} onChange={s('password')} hint="Min 8 chars, letters + numbers" />
        <Input label="City" value={f.city} onChange={s('city')} />
        <GstFields enabled={f.gst_enabled} number={f.gst_number} onEnabled={(v) => setF({ ...f, gst_enabled: v })} onNumber={(v) => setF({ ...f, gst_number: v })} />
      <QrSwitch checked={f.qr_enabled} onChange={(v) => setF({ ...f, qr_enabled: v })} />
      <LangSelect value={f.default_language} onChange={(v) => setF({ ...f, default_language: v })} />
        <Select label="Subscription" value={f.billing_cycle} onChange={s('billing_cycle')}>
          <option value="">{tr('Customer purchases the plan on first login')}</option>
          <option value="monthly">{tr('I grant 1 month now')}</option>
          <option value="yearly">{tr('I grant 1 year now')}</option>
        </Select>
        <p className="text-xs text-muted">{f.billing_cycle ? tr('The company is active immediately for the chosen period. Renew it later from Manage.') : tr('The owner’s first screen after signing in is the plan page (monthly or yearly). The app opens after they pay.')}</p>
        <Button type="submit" loading={busy} className="w-full">Create</Button>
      </form>
    </Modal>
  )
}
