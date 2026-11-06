import { useState } from 'react'
import { LogOut, Sparkles } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useApi } from '../../lib/useApi'
import { purchase } from '../../lib/payment'
import { useT } from '../../i18n'
import LangSwitch from '../../components/LangSwitch'
import { money } from '../../lib/format'
import PlanCards from '../../components/PlanCards'
import { Button, Card, Spinner } from '../../components/ui'

/** First screen for a company that has no subscription yet: choose monthly or yearly and pay. */
export default function Onboarding() {
  const { company, user, can, refresh, logout } = useAuth()
  const t = useT()
  const toast = useToast()
  const ask = useConfirm()
  const { data: price } = useApi('/subscription/pricing', { skip: !can('subscription.manage') })
  const [busy, setBusy] = useState(null)
  const owner = can('subscription.manage')

  const buy = async (cycle) => {
    const amount = cycle === 'yearly' ? price.price_yearly : price.price_monthly
    if (!(await ask({
      title: cycle === 'yearly' ? t('Start yearly plan?') : t('Start monthly plan?'),
      message: cycle === 'yearly'
        ? t('{amount} for 1 year. Your app opens as soon as the payment succeeds.', { amount: money(amount) })
        : t('{amount} for 1 month. Your app opens as soon as the payment succeeds.', { amount: money(amount) }),
      confirmText: t('Pay {amount}', { amount: money(amount) }),
      tone: 'primary',
    }))) return
    setBusy(cycle)
    try {
      const sub = await purchase(cycle)
      if (sub) { toast.success(t('Payment successful. Welcome!')); await refresh() }
    } catch (e) { toast.error(e) } finally { setBusy(null) }
  }

  return (
    <div className="min-h-dvh bg-canvas pb-10">
      <header className="bg-brand px-5 pb-16 pt-[calc(1.5rem+env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {company?.logo_url
              ? <img src={company.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-xl bg-white object-contain p-1" />
              : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 text-lg font-extrabold">{company?.name?.[0]}</span>}
            <div className="min-w-0">
              <div className="truncate text-base font-extrabold">{company?.name}</div>
              <div className="truncate text-xs text-white/70">{user?.name}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LangSwitch tone="dark" />
            <button onClick={logout} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 transition active:scale-95" aria-label={t('Sign out')}><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-10 max-w-3xl space-y-5 px-4">
        <Card className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent"><Sparkles className="h-6 w-6" /></span>
          <h1 className="mt-3 text-[22px] font-extrabold leading-tight tracking-tight">{t('Choose your plan to get started')}</h1>
          <p className="mt-1 text-sm text-muted">{t('Pick monthly or yearly. You can renew any time from the Subscription page.')}</p>
        </Card>

        {owner
          ? (price ? <PlanCards price={price} onBuy={buy} busy={busy} verb="Start" /> : <Spinner />)
          : (
            <Card className="text-center text-sm text-muted">
              {t('Your owner needs to choose a plan before the app can be used. Please ask them to sign in and complete the purchase.')}
              <Button variant="secondary" className="mt-4 w-full" onClick={() => refresh()}>{t('I have asked — check again')}</Button>
            </Card>
          )}
      </main>
    </div>
  )
}
