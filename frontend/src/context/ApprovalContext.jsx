import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button, Input, Modal } from '../components/ui'
import { useT } from '../i18n'

const ApprovalCtx = createContext(null)

/**
 * Some actions need the owner's approval PIN (voiding a bill, a big discount, cancelling an order the kitchen already started).
 *
 *   const approve = useApproval()
 *   try { await approve((pin) => api.patch(url, body, pin ? { headers: { 'X-Approval-Pin': pin } } : undefined)) }
 *   catch (e) { if (!e.cancelled) toast.error(e) }
 *
 * The call runs normally. If the server answers "needs the owner's PIN", a PIN box opens and the call is repeated with the PIN.
 * A wrong PIN shows the server's message; closing the box rejects with { cancelled: true } (nothing to report).
 */
export const useApproval = () => useContext(ApprovalCtx)

export function ApprovalProvider({ children }) {
  const t = useT()
  const [box, setBox] = useState(null) // { message }
  const [pin, setPin] = useState('')
  const resolver = useRef(null)

  const ask = useCallback((message) => new Promise((resolve) => {
    resolver.current = resolve
    setPin('')
    setBox({ message })
  }), [])

  const close = (value) => {
    resolver.current?.(value)
    resolver.current = null
    setBox(null)
  }

  const run = useCallback(async (call) => {
    try {
      return await call(null)
    } catch (e) {
      const d = e?.response?.data
      if (e?.response?.status === 403 && d?.code === 'approval_required' && d.has_pin) {
        const entered = await ask(d.message)
        if (!entered) throw Object.assign(new Error('cancelled'), { cancelled: true })

        return call(entered)
      }
      throw e
    }
  }, [ask])

  return (
    <ApprovalCtx.Provider value={run}>
      {children}
      <Modal open={!!box} onClose={() => close(null)} title={t('Owner approval')}>
        {box && (
          <form onSubmit={(e) => { e.preventDefault(); if (pin) close(pin) }} className="space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-brand"><ShieldCheck className="h-7 w-7" /></div>
            <p className="text-sm text-muted">{t(box.message)}</p>
            <Input aria-label={t('Approval PIN')} type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" className="text-center text-2xl tracking-[0.5em]" />
            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="secondary" size="lg" onClick={() => close(null)}>{t('Cancel')}</Button>
              <Button type="submit" size="lg" disabled={pin.length < 4}>{t('Approve')}</Button>
            </div>
          </form>
        )}
      </Modal>
    </ApprovalCtx.Provider>
  )
}
