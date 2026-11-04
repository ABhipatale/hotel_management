import { useEffect, useState } from 'react'
import { api, toFormData } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { dt } from '../../lib/format'
import ImagePicker from '../../components/ImagePicker'
import { Button, Card, Input, PageHeader, Select, Spinner, Textarea } from '../../components/ui'

export default function Settings() {
  const { refresh, hasFeature } = useAuth()
  const toast = useToast()
  const { data: company, loading } = useApi('/company')
  const { data: printer } = useApi('/printer')
  const { data: logs } = useApi('/audit-logs')
  const { data: tickets, reload: reloadTickets } = useApi('/support')
  const [f, setF] = useState(null)
  const [logo, setLogo] = useState(null)
  const [icon, setIcon] = useState(null)
  const [removeIcon, setRemoveIcon] = useState(false)
  const [p, setP] = useState(null)
  const [t, setT] = useState({ subject: '', message: '' })

  useEffect(() => { if (company) setF(company) }, [company])
  useEffect(() => { if (printer) setP(printer); else if (printer === null) setP({ paper_width: '80mm', connection: 'browser', use_escpos: true, show_logo: true }) }, [printer])

  const saveCompany = async (e) => {
    e.preventDefault()
    const { logo_url, logo_path, icon_url, icon_path, id, uid, slug, status, created_at, updated_at, deleted_at, settings, business_name, ...rest } = f
    try {
      const { data } = await api.post('/company', toFormData({ ...rest, logo, icon, remove_icon: removeIcon || undefined }))
      setF(data); setLogo(null); setIcon(null); setRemoveIcon(false)
      toast.success('Branding updated')
      await refresh()
    } catch (x) { toast.error(x) }
  }
  const savePrinter = async (e) => {
    e.preventDefault()
    try { await api.put('/printer', { paper_width: p.paper_width, connection: p.connection, ip_address: p.ip_address || null, port: p.port || null, use_escpos: !!p.use_escpos, show_logo: !!p.show_logo }); toast.success('Printer settings saved') } catch (x) { toast.error(x) }
  }
  const ticket = async (e) => {
    e.preventDefault()
    try { await api.post('/support', t); setT({ subject: '', message: '' }); toast.success('Support request sent'); reloadTickets() } catch (x) { toast.error(x) }
  }
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value })

  if (loading || !f || !p) return <Spinner />
  return (
    <>
      <PageHeader title="Settings" sub="Branding, bill layout and printer" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Company & branding</h3>
          <form onSubmit={saveCompany} className="space-y-3">
            <Input label="Company name" required value={f.name || ''} onChange={s('name')} />
            <div className="grid grid-cols-2 gap-3"><Input label="Phone" value={f.phone || ''} onChange={s('phone')} /><Input label="GST number" value={f.gst_number || ''} onChange={s('gst_number')} /></div>
            <Input label="Address" value={f.address || ''} onChange={s('address')} />
            <div className="grid grid-cols-3 gap-3"><Input label="City" value={f.city || ''} onChange={s('city')} /><Input label="State" value={f.state || ''} onChange={s('state')} /><Input label="PIN" value={f.pin_code || ''} onChange={s('pin_code')} /></div>
            <div className="space-y-5 rounded-2xl bg-slate-50 p-4">
              <ImagePicker label="Company logo" hint="Shown in the app header, on bills and on your QR menu. Any shape; PNG with transparent background looks best." current={f.logo_url} file={logo} onChange={setLogo} rounded="rounded-2xl" fit="object-contain bg-white" />
              <ImagePicker label="App icon" hint="The icon on the phone home screen when installed. Square PNG, at least 512 x 512 px (min 192)." current={removeIcon ? null : f.icon_url} file={icon} onChange={(x) => { setIcon(x); setRemoveIcon(false) }} onRemove={f.icon_url ? () => setRemoveIcon(true) : undefined} />
              <Input label="Brand colour" type="color" className="h-12 w-24 p-1" value={f.brand_color || '#4f46e5'} onChange={s('brand_color')} />
            </div>
            <Textarea label="Bill header" value={f.bill_header || ''} onChange={s('bill_header')} />
            <Textarea label="Bill footer" value={f.bill_footer || ''} onChange={s('bill_footer')} />
            <Button type="submit" className="w-full">Save branding</Button>
          </form>
        </Card>

        <div className="space-y-5">
          <Card>
            <h3 className="mb-3 font-semibold">Thermal printer</h3>
            {!hasFeature('thermal') && <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Direct thermal printing needs the Pro plan; browser print is always available.</p>}
            <form onSubmit={savePrinter} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Select label="Paper width" value={p.paper_width} onChange={(e) => setP({ ...p, paper_width: e.target.value })}><option value="58mm">58 mm</option><option value="80mm">80 mm</option></Select>
                <Select label="Connection" value={p.connection} onChange={(e) => setP({ ...p, connection: e.target.value })}><option value="browser">Browser print</option><option value="usb">USB</option><option value="bluetooth">Bluetooth</option><option value="network">Network</option></Select>
              </div>
              {p.connection === 'network' && <div className="grid grid-cols-2 gap-3"><Input label="Printer IP" value={p.ip_address || ''} onChange={(e) => setP({ ...p, ip_address: e.target.value })} /><Input label="Port" type="number" value={p.port || 9100} onChange={(e) => setP({ ...p, port: e.target.value })} /></div>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!p.use_escpos} onChange={(e) => setP({ ...p, use_escpos: e.target.checked })} /> Use ESC/POS commands (USB / Bluetooth)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!p.show_logo} onChange={(e) => setP({ ...p, show_logo: e.target.checked })} /> Print logo on browser receipts</label>
              <Button type="submit" className="w-full">Save printer</Button>
            </form>
          </Card>

          <Card>
            <h3 className="mb-3 font-semibold">Contact support</h3>
            <form onSubmit={ticket} className="space-y-3">
              <Input label="Subject" required value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} />
              <Textarea label="Message" required value={t.message} onChange={(e) => setT({ ...t, message: e.target.value })} />
              <Button type="submit" variant="secondary" className="w-full">Send</Button>
            </form>
            {tickets?.slice(0, 3).map((x) => <div key={x.id} className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><b>{x.subject}</b> <span className="text-xs text-muted">· {x.status}</span>{x.reply && <p className="mt-1 text-muted">Reply: {x.reply}</p>}</div>)}
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-semibold">Audit log</h3>
          <div className="max-h-72 overflow-y-auto">
            {logs?.length ? logs.map((l) => <div key={l.id} className="flex flex-col gap-0.5 border-b border-line py-2 text-sm last:border-0 sm:flex-row sm:justify-between sm:gap-3"><span>{l.action}{l.entity ? ` · ${l.entity} #${l.entity_id}` : ''}</span><span className="text-xs text-muted">{dt(l.created_at)} · {l.ip}</span></div>) : <p className="py-6 text-center text-sm text-muted">Nothing logged yet</p>}
          </div>
        </Card>
      </div>
    </>
  )
}
