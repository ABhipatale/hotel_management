import { useEffect, useState } from 'react'
import { CalendarDays, CalendarRange, IndianRupee } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { Button, Card, Input, PageHeader, Spinner } from '../../components/ui'

/** One subscription for every company, sold monthly or yearly. The super admin only sets the two prices. */
export default function Pricing() {
  const toast = useToast()
  const { data, loading, reload } = useApi('/admin/pricing')
  const [f, setF] = useState({ price_monthly: '', price_yearly: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (data) setF({ price_monthly: data.price_monthly, price_yearly: data.price_yearly }) }, [data])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await api.put('/admin/pricing', f); toast.success('Prices updated'); reload() } catch (x) { toast.error(x) } finally { setBusy(false) }
  }

  if (loading) return <Spinner />

  const m = Number(f.price_monthly) || 0
  const y = Number(f.price_yearly) || 0
  const saving = m > 0 && y > 0 ? m * 12 - y : 0

  return (
    <>
      <PageHeader title="Pricing" sub="One subscription for every company — monthly or yearly" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <form onSubmit={save} className="space-y-4">
            <Input label="Monthly price (₹)" icon={CalendarDays} type="number" min="0" step="0.01" required inputMode="decimal" value={f.price_monthly} onChange={(e) => setF({ ...f, price_monthly: e.target.value })} />
            <Input label="Yearly price (₹)" icon={CalendarRange} type="number" min="0" step="0.01" required inputMode="decimal" value={f.price_yearly} onChange={(e) => setF({ ...f, price_yearly: e.target.value })} hint={saving > 0 ? `Customers save ${money(saving)} a year compared with paying monthly.` : 'Usually lower than 12 monthly payments.'} />
            <Button type="submit" size="lg" loading={busy} className="w-full">Save prices</Button>
          </form>
        </Card>

        <Card className="!border-brand !bg-brand text-white">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/75"><IndianRupee className="h-4 w-4" /> What companies see</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
              <div className="text-xs font-semibold text-white/70">Monthly</div>
              <div className="tabular mt-1 text-2xl font-extrabold">{money(m)}</div>
              <div className="text-xs text-white/60">per month</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
              <div className="flex items-center justify-between text-xs font-semibold text-white/70">Yearly {saving > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-extrabold text-white">SAVE</span>}</div>
              <div className="tabular mt-1 text-2xl font-extrabold">{money(y)}</div>
              <div className="text-xs text-white/60">per year{y > 0 ? ` · ${money(y / 12)}/mo` : ''}</div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/70">Every company gets all features with unlimited staff and tables. New prices apply from the next purchase or renewal; running subscriptions are not affected.</p>
        </Card>
      </div>
    </>
  )
}
