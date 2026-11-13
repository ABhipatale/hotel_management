import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { counterColor, counterStore } from '../lib/counter'
import { useT } from '../i18n'
import { Card } from '../components/ui'
import { Store } from 'lucide-react'

const Ctx = createContext({ multi: false })
export const useCounter = () => useContext(Ctx)

/** Counter state for the signed-in user. Single-counter companies: `multi` is false and nothing else changes. */
export function CounterProvider({ children }) {
  const { user, company, counters, counter: mine } = useAuth()
  const multi = !!company?.multi_counter
  const isOwner = user?.role === 'owner'
  const list = useMemo(() => (counters || []).map((c, i) => ({ ...c, color: counterColor(i) })), [counters])
  const [selected, setSel] = useState(counterStore.get())

  // A saved choice that no longer exists (counter removed/disabled) falls back to "all counters"
  useEffect(() => {
    if (!multi || !isOwner) { counterStore.set(''); setSel(''); return }
    if (selected && !list.some((c) => String(c.id) === String(selected) && c.is_active)) { counterStore.set(''); setSel('') }
  }, [multi, isOwner, list, selected])

  const select = useCallback((id) => { counterStore.set(id); setSel(id ? String(id) : '') }, [])

  const value = useMemo(() => {
    const current = isOwner ? list.find((c) => String(c.id) === String(selected)) || null : mine ? { ...mine, color: counterColor(0) } : null
    return {
      multi, isOwner, counters: list, selected: isOwner ? selected : '', select, current,
      nameOf: (id) => list.find((c) => c.id === id)?.name,
      colorOf: (id) => list.find((c) => c.id === id)?.color,
      // true while the owner is looking at every counter at once
      allCounters: multi && isOwner && !selected,
    }
  }, [multi, isOwner, list, selected, select, mine])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Screens that work on ONE counter (tables, new order, expenses, stock) ask the owner to pick one first. */
export function NeedCounter({ children }) {
  const { allCounters, counters, select } = useCounter()
  const t = useT()
  if (!allCounters) return children
  return (
    <Card className="mx-auto mt-6 max-w-xl text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Store className="h-7 w-7" /></div>
      <h2 className="mt-4 text-xl font-extrabold tracking-tight">{t('Choose a counter')}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{t('This screen works on one counter at a time. Pick the counter you want to manage.')}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {counters.filter((c) => c.is_active).map((c) => (
          <button key={c.id} onClick={() => select(c.id)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold shadow-card ring-1 ring-line transition active:scale-95 hover:ring-brand/40">
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.name}
          </button>
        ))}
      </div>
    </Card>
  )
}
