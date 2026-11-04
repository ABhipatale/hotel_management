import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Receipt, Store, UtensilsCrossed } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { errMsg } from '../../lib/api'
import { Button, ErrorNote, Input } from '../../components/ui'

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
    <div className="flex min-h-screen flex-col bg-brand-gradient lg:flex-row">
      {/* Hero */}
      <div className="safe-top relative flex flex-1 flex-col justify-end overflow-hidden px-6 pb-10 pt-14 text-white lg:justify-center lg:px-16">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -left-10 top-1/3 h-40 w-40 rounded-full bg-white/10" />
        <div className="relative">
          <div className="mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-white/20 shadow-lg backdrop-blur"><Store className="h-8 w-8" /></div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">Run your<br />restaurant,<br />effortlessly.</h1>
          <p className="mt-3 max-w-xs text-sm text-white/80">Tables, orders and bills — all in one place, right from your phone.</p>
          <div className="mt-5 hidden gap-3 text-xs font-medium text-white/90 sm:flex">
            <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5"><UtensilsCrossed className="h-3.5 w-3.5" /> Quick orders</span>
            <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5"><Receipt className="h-3.5 w-3.5" /> Fast billing</span>
          </div>
        </div>
      </div>

      {/* Form sheet */}
      <div className="safe-bottom flex items-center justify-center rounded-t-[2.5rem] bg-white px-6 pb-8 pt-8 shadow-float lg:w-[30rem] lg:rounded-none lg:px-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">Welcome back 👋</h2>
            <p className="text-sm text-muted">Sign in to continue</p>
          </div>
          <ErrorNote>{err}</ErrorNote>
          <Input label="Email" type="email" autoComplete="username" inputMode="email" required placeholder="you@restaurant.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input label="Password" type="password" autoComplete="current-password" required placeholder="••••••••" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Button type="submit" size="lg" loading={busy} className="w-full">Sign in <ArrowRight className="h-5 w-5" /></Button>
          <p className="pt-1 text-center text-sm text-muted">New restaurant or hotel? <Link to="/register" className="font-bold text-brand">Start free trial</Link></p>
        </form>
      </div>
    </div>
  )
}
