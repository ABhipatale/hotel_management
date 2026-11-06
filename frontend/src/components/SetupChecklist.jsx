import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, X } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { useAuth } from '../context/AuthContext'
import { useT } from '../i18n'
import { Card } from './ui'

const KEY = 'hms.setup.hidden'

/** First-run guide for a new owner: add dishes, tables and a waiter. Disappears by itself once done (or when dismissed). */
export default function SetupChecklist() {
  const t = useT()
  const { can, company } = useAuth()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY + company?.id) === '1' } catch { return false } })
  const { data: items } = useApi('/menu/items', { skip: hidden || !can('menu.manage') })
  const { data: tables } = useApi('/tables', { skip: hidden || !can('tables.view') })
  const { data: staff } = useApi('/staff', { skip: hidden || !can('users.manage') })
  if (hidden || !items || !tables || !staff) return null

  const steps = [
    { done: items.length > 0, to: '/app/menu', label: t('Add your dishes and prices') },
    { done: tables.length > 0, to: '/app/tables', label: t('Add your tables (optional for takeaway)') },
    { done: staff.length > 1, to: '/app/staff', label: t('Add a waiter login') },
  ]
  if (steps.every((s) => s.done)) return null
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY + company?.id, '1') } catch { /* ignore */ } }

  return (
    <Card className="!border-accent/40 !bg-accent-soft">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-extrabold">{t('Get started in 3 steps')}</div>
          <div className="text-xs text-muted">{t('Do these once and you are ready to take orders.')}</div>
        </div>
        <button onClick={dismiss} aria-label={t('Close')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/70 text-muted active:scale-95"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <Link key={s.to} to={s.to} className="flex min-h-12 items-center gap-3 rounded-2xl bg-white px-3.5 py-2 text-sm font-semibold shadow-card active:scale-[.98]">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${s.done ? 'bg-brand text-white' : 'bg-accent text-white'}`}>{s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}</span>
            <span className={`flex-1 ${s.done ? 'text-muted line-through' : ''}`}>{s.label}</span>
            {!s.done && <ChevronRight className="h-4 w-4 text-muted" />}
          </Link>
        ))}
      </div>
    </Card>
  )
}
