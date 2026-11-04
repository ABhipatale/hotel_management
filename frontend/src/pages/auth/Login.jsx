import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, BarChart3, Lock, Mail, QrCode, Receipt, ShieldCheck, Store } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { errMsg } from '../../lib/api'
import { Button, ErrorNote, Input } from '../../components/ui'

const PERKS = [
  { icon: QrCode, text: 'QR ordering' },
  { icon: Receipt, text: 'Fast billing' },
  { icon: BarChart3, text: 'Live sales' },
]

export default function Login() {
  const a = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (a.user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await a.login(f.email, f.password)
      nav('/', { replace: true })
    } catch (x) {
      setErr(errMsg(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-brand-gradient lg:flex-row">
      {/* Hero */}
      <div className="safe-top relative flex flex-1 flex-col justify-end overflow-hidden px-6 pb-12 pt-14 text-white lg:justify-center lg:px-20">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -left-12 top-1/3 h-44 w-44 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute bottom-10 right-8 h-20 w-20 rounded-[1.25rem] bg-accent/25 rotate-12" />
        <div className="animate-page relative">
          <div className="mb-6 grid h-16 w-16 place-items-center rounded-[1.4rem] bg-white/20 shadow-lg ring-1 ring-white/30 backdrop-blur"><Store className="h-8 w-8" /></div>
          <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-tight sm:text-5xl">Run your<br />restaurant,<br />effortlessly.</h1>
          <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-white/80">Tables, orders and bills — beautifully simple, right from your phone.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {PERKS.map(({ icon: Icon, text }) => (
              <span key={text} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-xs font-bold ring-1 ring-white/20 backdrop-blur"><Icon className="h-3.5 w-3.5" />{text}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Form sheet */}
      <div className="safe-bottom flex items-center justify-center rounded-t-[1.25rem] bg-white px-6 pb-8 pt-9 shadow-float lg:w-[32rem] lg:rounded-none lg:px-14">
        <form onSubmit={submit} className="animate-page w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-[26px] font-extrabold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-sm text-muted">Sign in to continue to your dashboard</p>
          </div>
          <ErrorNote>{err}</ErrorNote>
          <Input label="Email" icon={Mail} type="email" autoComplete="username" inputMode="email" required placeholder="you@restaurant.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input label="Password" icon={Lock} type="password" autoComplete="current-password" required placeholder="Enter your password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Button type="submit" size="lg" loading={busy} className="w-full">Sign in <ArrowRight className="h-5 w-5" /></Button>
          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Secure, encrypted sign-in</div>
          <p className="border-t border-line pt-4 text-center text-sm text-muted">New restaurant or hotel? <Link to="/register" className="inline-flex min-h-11 items-center px-1 font-extrabold text-brand">Start free trial</Link></p>
        </form>
      </div>
    </div>
  )
}
