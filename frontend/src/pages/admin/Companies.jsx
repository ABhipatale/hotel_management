import { useState } from 'react'
import { Check, LayoutGrid, Plus, Search, Store } from 'lucide-react'
import { api, toFormData } from '../../lib/api'
import ImagePicker from '../../components/ImagePicker'
import { useApi } from '../../lib/useApi'
import { dateOnly, money } from '../../lib/format'
import { useT } from '../../i18n'
import { counterColor } from '../../lib/counter'
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
                {c.icon_url || c.logo_url ? <img src={c.icon_url || c.logo_url} alt="" decoding="async" className="h-10 w-10 shrink-0 rounded-xl object-cover" /> : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft font-bold text-brand">{c.name[0]}</div>}
                <div><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{c.uid} · {c.email}</div></div>
              </div>
            ) },
            { header: 'Subscription', render: (c) => (
              <div className="space-y-1">
                {c.current_subscription ? <span className="capitalize">{tr(c.current_subscription.billing_cycle)}</span> : <Badge tone="amber">Awaiting purchase</Badge>}
                {(c.price_monthly != null || c.price_yearly != null) && <div><Badge tone="violet" dot={false}>Custom price</Badge></div>}
                {c.kot_enabled && <div><Badge tone="amber" dot={false}>{c.kot_screen === false ? 'KOT print only' : `KOT${c.kot_print ? ' + print' : ''}`}</Badge></div>}
              </div>
            ) },
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
                {detail.multi_counter && <CountersEditor key={detail.id} company={detail} />}
                <BrandingEditor company={detail} onDone={(c) => { setDetail(c); reload() }} />
                <CompanyPrice key={detail.id} company={detail} onDone={(c) => { setDetail(c); reload() }} />
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

/** One counter (as always) or several counters, each with its own tables, staff and books. */
function CounterMode({ multi, names, onMulti, onNames, locked }) {
  const tr = useT()
  const opt = (on, Icon, title, text, value) => (
    <button type="button" disabled={locked && !on} onClick={() => onMulti(value)} aria-pressed={on}
      className={`relative flex flex-1 flex-col items-start gap-1.5 rounded-2xl border-2 p-3.5 text-left transition active:scale-[.99] disabled:opacity-50 ${on ? 'border-brand bg-brand-soft/60' : 'border-line bg-white hover:border-slate-300'}`}>
      {on && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-brand text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>}
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${on ? 'bg-brand text-white' : 'bg-canvas text-slate-500'}`}><Icon className="h-[18px] w-[18px]" /></span>
      <span className="text-sm font-extrabold">{tr(title)}</span>
      <span className="text-xs leading-snug text-muted">{tr(text)}</span>
    </button>
  )
  return (
    <div className="space-y-3">
      <div className="text-sm font-bold">{tr('Counters')}</div>
      <div className="flex gap-3">
        {opt(!multi, Store, 'One counter', 'Works exactly as it does today.', false)}
        {opt(multi, LayoutGrid, 'Multiple counters', 'Each counter has its own tables, login and books. The owner sees every counter and the total.', true)}
      </div>
      {onNames && multi && (
        <div className="space-y-2 rounded-2xl bg-canvas p-3 ring-1 ring-line">
          <div className="text-xs font-bold text-muted">{tr('Counter names')}</div>
          {names.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <i className="h-3 w-3 shrink-0 rounded-full" style={{ background: counterColor(i) }} />
              <input value={n} onChange={(e) => onNames(names.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Counter ${i + 1}`} className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" />
              {names.length > 1 && <button type="button" onClick={() => onNames(names.filter((_, j) => j !== i))} className="px-2 text-xs font-bold text-rose-600">{tr('Remove')}</button>}
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => onNames([...names, `Counter ${names.length + 1}`])}><Plus className="h-4 w-4" /> {tr('Add counter')}</Button>
        </div>
      )}
      {locked && multi && <p className="text-xs text-muted">{tr('To go back to one counter, the company must have only one counter left.')}</p>}
    </div>
  )
}

/** Platform admin: add / rename / disable the counters of a multi-counter company. */
function CountersEditor({ company }) {
  const toast = useToast()
  const tr = useT()
  const { data, reload } = useApi(`/admin/companies/${company.id}/counters`)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn) => { setBusy(true); try { await fn(); reload() } catch (e) { toast.error(e) } finally { setBusy(false) } }
  const add = (e) => { e.preventDefault(); if (name.trim()) run(async () => { await api.post(`/admin/companies/${company.id}/counters`, { name: name.trim() }); setName('') }) }
  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
      <div className="text-sm font-semibold">{tr('Counters')}</div>
      <div className="space-y-2">
        {(data || []).map((c, i) => (
          <div key={c.id} className={`flex items-center gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-line ${c.is_active ? '' : 'opacity-60'}`}>
            <i className="h-3 w-3 shrink-0 rounded-full" style={{ background: counterColor(i) }} />
            <input defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && run(() => api.put(`/admin/companies/${company.id}/counters/${c.id}`, { name: e.target.value.trim() }))} className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" aria-label={tr('Counter name')} />
            {c.is_default && <Badge tone="blue">default</Badge>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.put(`/admin/companies/${company.id}/counters/${c.id}`, { is_active: !c.is_active }))}>{c.is_active ? tr('Disable') : tr('Enable')}</Button>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('New counter name')} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-[16px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 sm:text-sm" />
        <Button type="submit" loading={busy} disabled={!name.trim()}><Plus className="h-4 w-4" /> {tr('Add')}</Button>
      </form>
      <p className="text-xs text-muted">{tr('Create a login for each counter from the owner\'s Staff screen (role: Counter manager).')}</p>
    </div>
  )
}

/** Kitchen order tickets: OFF = the hotel works exactly as before (no kitchen screen, nothing extra shown). */
function KotSwitch({ enabled, screen, print, mode, onEnabled, onScreen, onPrint, onMode }) {
  const tr = useT()
  return (
    <div className="space-y-3">
      <Switch label={tr('Kitchen tickets (KOT)')} checked={enabled} onChange={onEnabled} hint={enabled ? tr('Orders go to a kitchen screen as tickets; a Chef login and "ready" alerts for waiters are switched on.') : tr('Off: no kitchen screen. Orders work exactly as before.')} />
      {enabled && <Switch label={tr('Kitchen screen')} checked={screen} onChange={onScreen} hint={screen ? tr('A kitchen screen for the chef, a Chef login and "ready" alerts for waiters.') : tr('Off: no kitchen screen or Chef login. Only printed kitchen slips.')} />}
      {enabled && <Switch label={screen ? tr('Also print kitchen slips') : tr('Print kitchen slips')} checked={print || !screen} disabled={!screen} onChange={onPrint} hint={screen ? tr('Adds a printed KOT slip (thermal printer) in addition to the kitchen screen.') : tr('On: the printed slip is the whole KOT in this mode.')} />}
      {enabled && (print || !screen) && (
        <Select label={tr('When an order is placed')} value={mode || ''} onChange={(e) => onMode(e.target.value)} hint={tr('The starting choice for every device of this company. Each device can still change it in Settings.')}>
          <option value="">{tr('Each device decides')}</option>
          <option value="auto">{tr('Print the kitchen slip automatically')}</option>
          <option value="ask">{tr('Ask me each time (popup)')}</option>
          <option value="off">{tr('Do not print')}</option>
        </Select>
      )}
    </div>
  )
}

/** "KOT not printed" alerts (off = as before): only while printed kitchen slips are part of KOT (print on, or no kitchen screen). */
function KotAlertSwitch({ kot, on, onChange }) {
  const tr = useT()
  if (!kot.kot_enabled || !(kot.kot_print || !kot.kot_screen)) return null
  return <Switch label={tr('KOT not printed: alert owner, manager and captains')} checked={on} onChange={onChange} hint={on ? tr("When a waiter's phone does not print the kitchen slip, the owner, counter manager and captains see it with a Print KOT button.") : tr('Off: nobody is told when a kitchen slip was not printed (as before).')} />
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
    gst_enabled: company.gst_enabled !== false, gst_number: company.gst_number || '', qr_enabled: company.qr_enabled !== false, kot_enabled: !!company.kot_enabled, kot_screen: company.kot_screen !== false, kot_print: !!company.kot_print, kot_print_mode: company.kot_print_mode || '', use_library_images: company.use_library_images !== false, default_language: company.default_language || 'en', multi_counter: !!company.multi_counter, parcel_enabled: !!company.parcel_enabled, table_sharing_enabled: !!company.table_sharing_enabled, upi_qr_enabled: !!company.upi_qr_enabled, payroll_enabled: !!company.payroll_enabled,
  })
  const [busy, setBusy] = useState(false)
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setBusy(true)
    try {
      const { data } = await api.put(`/admin/companies/${company.id}`, { ...f, kot_print_mode: f.kot_print_mode || null, gst_number: f.gst_enabled ? f.gst_number || null : undefined })
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
      <CounterMode multi={f.multi_counter} onMulti={(v) => setF({ ...f, multi_counter: v })} locked={!!company.multi_counter} />
      <QrSwitch checked={f.qr_enabled} onChange={(v) => setF({ ...f, qr_enabled: v })} />
      <Switch label="Parcel counters" checked={f.parcel_enabled} onChange={(v) => setF({ ...f, parcel_enabled: v })} hint={f.parcel_enabled ? 'Parcel 1, Parcel 2... can be added in Tables and chosen in New order. Customer name is asked at checkout.' : 'Off: this hotel has only tables and plain takeaway / delivery.'} />
      <Switch label="Shared tables" checked={f.table_sharing_enabled} onChange={(v) => setF({ ...f, table_sharing_enabled: v })} hint={f.table_sharing_enabled ? 'A table can be split in two (T1A and T1B), each with its own order and bill. It becomes one table again when both bills are paid.' : 'Off: every table has one order and one bill at a time.'} />
      <Switch label="Staff salary & advances" checked={f.payroll_enabled} onChange={(v) => setF({ ...f, payroll_enabled: v })} hint={f.payroll_enabled ? 'The owner gets a Salary page: fixed monthly pay, advances (uchal), absent-day cuts and the monthly salary payment.' : 'Off: no Salary page for this company.'} />
      <Switch label="UPI payment QR on bill" checked={f.upi_qr_enabled} onChange={(v) => setF({ ...f, upi_qr_enabled: v })} hint={f.upi_qr_enabled ? 'Unpaid bills print a scan-to-pay QR with the exact amount. The owner is asked once for the hotel\'s UPI ID.' : 'Off: no payment QR on this company\'s bills.'} />
      <KotSwitch enabled={f.kot_enabled} screen={f.kot_screen} print={f.kot_print} mode={f.kot_print_mode} onEnabled={(v) => setF({ ...f, kot_enabled: v, kot_screen: v ? f.kot_screen : true, kot_print: v ? f.kot_print : false, kot_print_mode: v ? f.kot_print_mode : '' })} onScreen={(v) => setF({ ...f, kot_screen: v, kot_print: v ? f.kot_print : true })} onPrint={(v) => setF({ ...f, kot_print: v, kot_print_mode: v ? f.kot_print_mode : '' })} onMode={(v) => setF({ ...f, kot_print_mode: v })} />
      <KotAlertSwitch kot={f} on={f.kot_unprinted_alert ?? !!company.kot_unprinted_alert} onChange={(v) => setF({ ...f, kot_unprinted_alert: v })} />
      <Switch label="Platform dish photos" checked={f.use_library_images} onChange={(v) => setF({ ...f, use_library_images: v })} hint={f.use_library_images ? 'Dishes without their own photo show matching photos from the platform image library.' : 'Only this company\'s own photos are shown. The platform library is hidden for it.'} />
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
      <ImagePicker raw label="App icon (square, 512 x 512 recommended)" current={removeIcon ? null : company.icon_url} file={icon} onChange={(x) => { setIcon(x); setRemoveIcon(false) }} onRemove={company.icon_url ? () => setRemoveIcon(true) : undefined} />
      <Button className="w-full" disabled={!dirty} loading={busy} onClick={save}>Save branding</Button>
    </div>
  )
}

/** Super admin: this company's own subscription price. Empty = it pays the platform default price. */
function CompanyPrice({ company, onDone }) {
  const toast = useToast()
  const tr = useT()
  const { data: def } = useApi('/admin/pricing')
  const [f, setF] = useState({ price_monthly: company.price_monthly ?? '', price_yearly: company.price_yearly ?? '' })
  const [busy, setBusy] = useState(false)
  const custom = company.price_monthly != null || company.price_yearly != null
  const save = async (body) => {
    setBusy(true)
    try {
      const { data } = await api.put(`/admin/companies/${company.id}`, body)
      toast.success('Price saved')
      setF({ price_monthly: data.price_monthly ?? '', price_yearly: data.price_yearly ?? '' })
      onDone({ ...company, ...data })
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  const val = (v) => (v === '' ? null : Number(v))
  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{tr('Subscription price')}</div>
        <Badge tone={custom ? 'violet' : 'slate'} dot={false}>{custom ? 'Custom price' : 'Default price'}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Monthly (₹)" type="number" min="0" step="0.01" inputMode="decimal" value={f.price_monthly} placeholder={def ? String(def.price_monthly) : ''} onChange={(e) => setF({ ...f, price_monthly: e.target.value })} />
        <Input label="Yearly (₹)" type="number" min="0" step="0.01" inputMode="decimal" value={f.price_yearly} placeholder={def ? String(def.price_yearly) : ''} onChange={(e) => setF({ ...f, price_yearly: e.target.value })} />
      </div>
      <p className="text-xs text-muted">{def ? tr('Leave a box empty to use the default price ({m} / month, {y} / year). A new price applies from the next purchase or renewal; a running subscription is not affected.', { m: money(def.price_monthly), y: money(def.price_yearly) }) : ''}</p>
      <div className="flex gap-2">
        <Button className="flex-1" loading={busy} onClick={() => save({ price_monthly: val(f.price_monthly), price_yearly: val(f.price_yearly) })}>{tr('Save price')}</Button>
        {custom && <Button variant="secondary" disabled={busy} onClick={() => save({ price_monthly: null, price_yearly: null })}>{tr('Use default')}</Button>}
      </div>
    </div>
  )
}

/** Optional: money collected offline (cash / UPI / bank / cheque) for the plan being granted. */
function OfflinePayment({ value, onChange }) {
  const tr = useT()
  const on = !!value
  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
      <Switch checked={on} onChange={(v) => onChange(v ? { amount: '', method: 'cash', note: '' } : null)} label={tr('Payment received offline')} />
      {on && (
        <>
          <Input label="Amount (₹)" type="number" min="0" step="0.01" inputMode="decimal" required value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
          <Select label="Method" value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value })}>
            {['cash', 'upi', 'bank', 'cheque', 'other'].map((m) => <option key={m} value={m}>{tr(m === 'upi' ? 'UPI' : m === 'bank' ? 'Bank transfer' : m[0].toUpperCase() + m.slice(1))}</option>)}
          </Select>
          <Input label="Reference / note" value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
        </>
      )}
    </div>
  )
}

function RenewSubscription({ company, onDone }) {
  const toast = useToast()
  const tr = useT()
  const has = !!company.current_subscription
  // A company that has not bought a plan keeps "Customer purchases the plan on first login" until the admin picks a period
  const [cycle, setCycle] = useState(has ? 'monthly' : '')
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(null)
  const go = async () => {
    if (!cycle) return
    setBusy(true)
    try { await api.post(`/admin/companies/${company.id}/subscription`, { billing_cycle: cycle, offline_payment: offline || undefined }); setOffline(null); onDone() } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
      <div className="text-sm font-semibold">{tr(has ? 'Renew subscription' : 'Subscription')}</div>
      <Select aria-label={tr('Billing period')} value={cycle} onChange={(e) => setCycle(e.target.value)}>
        <option value="monthly">{tr('Monthly')}</option><option value="yearly">{tr('Yearly')}</option>
        <option value="">{tr('Customer purchases the plan on first login')}</option>
      </Select>
      <p className="text-xs text-muted">
        {cycle ? tr(has ? "Extends from the current end date and records the payment at today's price." : 'The company is active immediately for the chosen period. Renew it later from Manage.')
          : tr(has ? 'This company already has a plan. Choose Monthly or Yearly to renew it.' : 'No plan is set. The owner sees the plan page after signing in and buys the plan.')}
      </p>
      {cycle && <OfflinePayment value={offline} onChange={setOffline} />}
      <Button className="w-full" disabled={!cycle} loading={busy} onClick={go}>{tr(has ? 'Renew' : 'Activate plan')}</Button>
    </div>
  )
}

function AddCompany({ open, onClose, onDone }) {
  const toast = useToast()
  const tr = useT()
  const [f, setF] = useState({ company_name: '', owner_name: '', phone: '', email: '', password: '', city: '', gst_enabled: true, qr_enabled: true, parcel_enabled: false, table_sharing_enabled: false, upi_qr_enabled: false, payroll_enabled: false, kot_enabled: false, kot_screen: true, kot_print: false, kot_print_mode: '', default_language: 'en', gst_number: '', billing_cycle: '', multi_counter: false })
  const [offline, setOffline] = useState(null)
  const [names, setNames] = useState(['Counter 1', 'Counter 2'])
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await api.post('/admin/companies', { ...f, kot_print_mode: f.kot_print_mode || undefined, counters: f.multi_counter ? names.filter((n) => n.trim()) : undefined, offline_payment: f.billing_cycle ? offline || undefined : undefined }); toast.success('Company created'); onDone() } catch (x) { toast.error(x) } finally { setBusy(false) }
  }
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open={open} onClose={onClose} title="Add company">
      <form onSubmit={submit} className="space-y-3">
        <Input label="Company name" required value={f.company_name} onChange={s('company_name')} />
        <Input label="Owner name" required value={f.owner_name} onChange={s('owner_name')} />
        <Input label="Mobile" required value={f.phone} onChange={s('phone')} />
        <Input label="Owner email" type="email" required value={f.email} onChange={s('email')} />
        <Input label="Initial password" type="password" required value={f.password} onChange={s('password')} hint="At least 6 characters (a 6-digit PIN is fine)" />
        <Input label="City" value={f.city} onChange={s('city')} />
        <GstFields enabled={f.gst_enabled} number={f.gst_number} onEnabled={(v) => setF({ ...f, gst_enabled: v })} onNumber={(v) => setF({ ...f, gst_number: v })} />
      <CounterMode multi={f.multi_counter} onMulti={(v) => setF({ ...f, multi_counter: v })} names={names} onNames={setNames} />
      <QrSwitch checked={f.qr_enabled} onChange={(v) => setF({ ...f, qr_enabled: v })} />
      <Switch label="Parcel counters" checked={f.parcel_enabled} onChange={(v) => setF({ ...f, parcel_enabled: v })} hint="Parcel 1, Parcel 2... (optional)" />
      <Switch label="Shared tables" checked={f.table_sharing_enabled} onChange={(v) => setF({ ...f, table_sharing_enabled: v })} hint="A table can be split in two, each with its own bill (optional)" />
      <Switch label="UPI payment QR on bill" checked={f.upi_qr_enabled} onChange={(v) => setF({ ...f, upi_qr_enabled: v })} hint="Scan-to-pay QR on unpaid bills (optional)" />
      <Switch label="Staff salary & advances" checked={f.payroll_enabled} onChange={(v) => setF({ ...f, payroll_enabled: v })} hint="Salary page: monthly pay, advances and deductions (optional)" />
      <KotSwitch enabled={f.kot_enabled} screen={f.kot_screen} print={f.kot_print} mode={f.kot_print_mode} onEnabled={(v) => setF({ ...f, kot_enabled: v, kot_screen: v ? f.kot_screen : true, kot_print: v ? f.kot_print : false, kot_print_mode: v ? f.kot_print_mode : '' })} onScreen={(v) => setF({ ...f, kot_screen: v, kot_print: v ? f.kot_print : true })} onPrint={(v) => setF({ ...f, kot_print: v, kot_print_mode: v ? f.kot_print_mode : '' })} onMode={(v) => setF({ ...f, kot_print_mode: v })} />
      <KotAlertSwitch kot={f} on={!!f.kot_unprinted_alert} onChange={(v) => setF({ ...f, kot_unprinted_alert: v })} />
      <LangSelect value={f.default_language} onChange={(v) => setF({ ...f, default_language: v })} />
        <Select label="Subscription" value={f.billing_cycle} onChange={s('billing_cycle')}>
          <option value="">{tr('Customer purchases the plan on first login')}</option>
          <option value="monthly">{tr('I grant 1 month now')}</option>
          <option value="yearly">{tr('I grant 1 year now')}</option>
        </Select>
        <p className="text-xs text-muted">{f.billing_cycle ? tr('The company is active immediately for the chosen period. Renew it later from Manage.') : tr('The owner’s first screen after signing in is the plan page (monthly or yearly). The app opens after they pay.')}</p>
        {f.billing_cycle && <OfflinePayment value={offline} onChange={setOffline} />}
        <Button type="submit" loading={busy} className="w-full">Create</Button>
      </form>
    </Modal>
  )
}
