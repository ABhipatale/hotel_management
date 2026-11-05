import { Check, ShieldCheck } from 'lucide-react'
import { money } from '../lib/format'
import { Button, Card } from './ui'

export const INCLUDED = ['Unlimited staff & tables', 'QR menu ordering', 'Thermal bill printing', 'Reports & inventory', 'Expenses & profit tracking']

/** Monthly / yearly price cards with the shared "included" list. `onBuy(cycle)`; `busy` is the cycle being paid. */
export default function PlanCards({ price, onBuy, busy, verb = 'Buy' }) {
  const saving = price.price_monthly * 12 - price.price_yearly
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col">
          <div className="text-sm font-bold text-muted">Monthly</div>
          <div className="tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight">{money(price.price_monthly)}</div>
          <div className="text-sm text-muted">per month</div>
          <Button className="mt-5 w-full" size="lg" loading={busy === 'monthly'} disabled={!!busy} onClick={() => onBuy('monthly')}>{verb} 1 month</Button>
        </Card>

        <Card className="relative flex flex-col !border-brand ring-2 ring-brand/20">
          {saving > 0 && <span className="absolute right-4 top-4 rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-white">Save {money(saving)}</span>}
          <div className="text-sm font-bold text-brand">Yearly · best value</div>
          <div className="tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight">{money(price.price_yearly)}</div>
          <div className="text-sm text-muted">per year · {money(price.price_yearly / 12)}/month</div>
          <Button variant="accent" className="mt-5 w-full" size="lg" loading={busy === 'yearly'} disabled={!!busy} onClick={() => onBuy('yearly')}>{verb} 1 year</Button>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="mb-3 text-sm font-extrabold">Included in both</div>
        <ul className="grid gap-2 text-sm font-medium sm:grid-cols-2">
          {INCLUDED.map((t) => <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-brand" strokeWidth={3} />{t}</li>)}
        </ul>
      </Card>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0" /> Secure online payment. Your plan starts the moment payment succeeds.</p>
    </>
  )
}
