import { createContext, useCallback, useContext, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { errMsg } from '../lib/api'
import { useT } from '../i18n'

const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

const SuccessIcon = () => (
  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/20">
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path className="check-path" d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  </span>
)

export function ToastProvider({ children }) {
  const tr = useT()
  const [items, setItems] = useState([])
  const push = useCallback((kind, text) => {
    const id = Math.random().toString(36).slice(2)
    setItems((i) => [...i.slice(-2), { id, kind, text }])
    setTimeout(() => setItems((i) => i.filter((x) => x.id !== id)), 3800)
  }, [])
  const api = {
    success: (t) => push('ok', t),
    error: (e) => push('err', typeof e === 'string' ? e : errMsg(e)),
  }
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
        {items.map((t) => (
          <div key={t.id} role="status" className="animate-toast pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-ink/95 px-3.5 py-3 text-sm font-medium text-white shadow-float ring-1 ring-white/10 backdrop-blur">
            {t.kind === 'ok' ? <SuccessIcon /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-500/20"><AlertCircle className="h-5 w-5 text-rose-400" /></span>}
            <span className="min-w-0 flex-1 leading-snug">{tr(t.text)}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
