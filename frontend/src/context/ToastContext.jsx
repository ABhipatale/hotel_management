import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { errMsg } from '../lib/api'

const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((kind, text) => {
    const id = Math.random().toString(36).slice(2)
    setItems((i) => [...i, { id, kind, text }])
    setTimeout(() => setItems((i) => i.filter((x) => x.id !== id)), 3500)
  }, [])
  const api = {
    success: (t) => push('ok', t),
    error: (e) => push('err', typeof e === 'string' ? e : errMsg(e)),
  }
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg">
            {t.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
