import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react'
import { Button } from '../components/ui'

const ConfirmCtx = createContext(null)

/**
 * In-app replacement for window.confirm().
 *   const ask = useConfirm()
 *   if (!(await ask({ title: 'Delete table?', message: '…', confirmText: 'Delete', tone: 'danger' }))) return
 */
export const useConfirm = () => useContext(ConfirmCtx)

const TONES = {
  danger: { icon: Trash2, ring: 'bg-rose-50 text-rose-600', button: 'danger' },
  warning: { icon: AlertTriangle, ring: 'bg-amber-50 text-amber-600', button: 'primary' },
  primary: { icon: HelpCircle, ring: 'bg-brand-soft text-brand', button: 'primary' },
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const resolver = useRef(null)

  const ask = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve
    setState({ tone: 'danger', confirmText: 'Confirm', cancelText: 'Cancel', ...opts })
  }), [])

  const close = useCallback((result) => {
    resolver.current?.(result)
    resolver.current = null
    setState(null)
  }, [])

  useEffect(() => {
    if (!state) return
    const onKey = (e) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [state, close])

  const t = state ? TONES[state.tone] || TONES.danger : null

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="animate-fade fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={() => close(false)}>
          <div onMouseDown={(e) => e.stopPropagation()} className="animate-sheet sm:animate-pop mb-[max(env(safe-area-inset-bottom),0px)] w-full max-w-sm rounded-[1.25rem] bg-white px-6 pb-6 pt-7 text-center shadow-float">
            <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full ${t.ring}`}>
              <t.icon className="h-8 w-8" />
            </div>
            <h3 id="confirm-title" className="text-xl font-extrabold tracking-tight">{state.title}</h3>
            {state.message && <p className="mt-2 text-sm leading-relaxed text-muted">{state.message}</p>}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button variant="secondary" size="lg" onClick={() => close(false)}>{state.cancelText}</Button>
              <Button variant={t.button} size="lg" autoFocus onClick={() => close(true)}>{state.confirmText}</Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}
