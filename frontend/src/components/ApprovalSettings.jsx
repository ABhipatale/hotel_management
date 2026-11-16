import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useT } from '../i18n'
import { useToast } from '../context/ToastContext'
import { useConfirm } from '../context/ConfirmContext'
import { Badge, Button, Input } from './ui'

/** Owner only: the approval PIN and how much discount staff may give without it. */
export default function ApprovalSettings() {
  const t = useT()
  const toast = useToast()
  const ask = useConfirm()
  const { data, reload } = useApi('/approvals')
  const [pin, setPin] = useState('')
  const [pct, setPct] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setPct(String(data.staff_discount_percent)) }, [data])
  if (!data) return null

  const save = async (body, msg) => {
    setBusy(true)
    try { await api.put('/approvals', body); toast.success(t(msg)); setPin(''); reload() } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  const dirty = pin.length >= 4 || String(data.staff_discount_percent) !== pct

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm"><ShieldCheck className="h-5 w-5 text-brand" /><span className="font-bold">{t('Approval PIN')}</span></div>
        <Badge tone={data.has_pin ? 'green' : 'amber'} dot={false}>{data.has_pin ? t('PIN is set') : t('Not set')}</Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t('With a PIN, staff need your approval to cancel a bill, to give a bigger discount, or to cancel an order the kitchen already started. You never have to enter it yourself.')}</p>
      <Input label={data.has_pin ? t('New PIN (4 to 8 digits)') : t('Set a PIN (4 to 8 digits)')} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      <Input label={t('Staff may give up to (%) extra discount without the PIN')} type="number" inputMode="decimal" min="0" max="100" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} />
      <div className="flex gap-2">
        <Button className="flex-1" loading={busy} disabled={!dirty} onClick={() => save({ ...(pin.length >= 4 ? { pin } : {}), staff_discount_percent: Number(pct || 0) }, 'Approvals saved')}>{t('Save')}</Button>
        {data.has_pin && <Button variant="secondary" disabled={busy} onClick={async () => (await ask({ title: t('Remove the approval PIN?'), message: t('Staff will no longer be asked for approval.'), confirmText: t('Remove PIN'), tone: 'warning' })) && save({ clear_pin: true }, 'PIN removed')}>{t('Remove PIN')}</Button>}
      </div>
    </div>
  )
}
