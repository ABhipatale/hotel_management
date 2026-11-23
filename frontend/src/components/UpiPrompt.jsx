import { useState } from 'react'
import { api } from '../lib/api'
import { validUpi } from '../lib/upiQr'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { Button, Input, Modal } from './ui'

const KEY = 'hms.upi.asked.'

/** Asked ONCE: when the platform admin has switched the UPI payment QR on for this hotel and no UPI ID is saved yet. The owner can enter it now or later in Settings. */
export default function UpiPrompt() {
  const { company, can, refresh } = useAuth()
  const toast = useToast()
  const [done, setDone] = useState(() => { try { return localStorage.getItem(KEY + company?.id) === '1' } catch { return false } })
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const open = !done && !!company?.upi_qr_enabled && !company?.upi_id && can('settings.manage')
  const close = () => { setDone(true); try { localStorage.setItem(KEY + company?.id, '1') } catch { /* ignore */ } }
  const save = async () => {
    setBusy(true)
    try { await api.post('/company', { upi_id: id.trim() }); await refresh(); toast.success('UPI ID saved'); close() } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={close} title="Payment QR on your bills">
      <div className="space-y-4">
        <p className="text-sm text-muted">Enter your UPI ID once. Unpaid bills will then print a QR with the exact amount, so customers can scan and pay. You can change it any time in Settings.</p>
        <Input label="UPI ID" placeholder="hotel@upi" autoCapitalize="none" autoComplete="off" value={id} onChange={(e) => setId(e.target.value)} hint={id && !validUpi(id) ? 'Enter a valid UPI ID like name@bank' : undefined} />
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={close}>Later</Button>
          <Button size="lg" loading={busy} disabled={!validUpi(id)} onClick={save}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}
