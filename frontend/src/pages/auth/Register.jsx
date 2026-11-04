import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Check, FileText, Lock, Mail, MapPin, Phone, Sparkles, Store, User } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { api, errMsg, toFormData } from '../../lib/api'
import { money } from '../../lib/format'
import ImagePicker from '../../components/ImagePicker'
import { Button, ErrorNote, Input } from '../../components/ui'

const EMPTY = {
  company_name: '', business_name: '', owner_name: '', phone: '', email: '', password: '', password_confirmation: '',
  address: '', city: '', state: '', pin_code: '', gst_number: '', plan_id: '',
}

const Step = ({ n, title, sub, children }) => (
  <section className="rounded-[1.25rem] border border-line/70 bg-white p-5 shadow-card sm:p-6">
    <div className="mb-5 flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-sm font-extrabold text-white">{n}</span>
      <div><h2 className="text-base font-extrabold leading-tight">{title}</h2><p className="text-xs text-muted">{sub}</p></div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{children}</div>
  </section>
)

export default function Register() {
  const a = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState(EMPTY)
  const [logo, setLogo] = useState(null)
  const [plans, setPlans] = useState([])
  const [errs, setErrs] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/plans').then((r) => {
      setPlans(r.data)
      setF((x) => ({ ...x, plan_id: r.data[0]?.id || '' }))
    })
  }, [])

  if (a.user) return <Navigate to="/" replace />
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setErrs({})
    if (f.password !== f.password_confirmation) return setErrs({ password_confirmation: 'Passwords do not match' })
    setBusy(true)
    try {
      await a.register(toFormData({ ...f, logo }))
      nav('/', { replace: true })
    } catch (x) {
      const v = x.response?.data?.errors
      if (v) setErrs(Object.fromEntries(Object.entries(v).map(([k, m]) => [k, m[0]])))
      setErr(errMsg(x))
    } finally {
      setBusy(false)
    }
  }

  const I = (k, label, extra = {}) => <Input label={label} value={f[k]} onChange={set(k)} error={errs[k]} {...extra} />

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Hero header */}
      <div className="safe-top relative overflow-hidden bg-brand-gradient px-5 pb-16 pt-6 text-white">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
        <div className="relative mx-auto max-w-3xl">
          <Link to="/login" className="mb-5 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-bold ring-1 ring-white/20 backdrop-blur"><ArrowLeft className="h-4 w-4" /> Sign in</Link>
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30"><Store className="h-7 w-7" /></div>
            <div><h1 className="text-[26px] font-extrabold leading-tight tracking-tight sm:text-3xl">Create your workspace</h1><p className="text-sm text-white/80">Set up your restaurant in minutes</p></div>
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="animate-page relative z-10 mx-auto -mt-10 max-w-3xl space-y-4 px-4 pb-12">
        <ErrorNote>{err}</ErrorNote>

        {plans[0] && (
          <section className="relative overflow-hidden rounded-[1.25rem] border border-brand/30 bg-brand-soft p-5 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-extrabold text-brand"><Sparkles className="h-4 w-4" /> {plans[0].name} plan</div>
                <div className="tabular mt-1 text-2xl font-extrabold">{money(plans[0].price_monthly)}<span className="text-sm font-semibold text-muted"> /month</span></div>
              </div>
              <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-extrabold text-white">{plans[0].trial_days}-day free trial</span>
            </div>
            <ul className="mt-3 grid gap-1.5 text-sm font-medium text-slate-700 sm:grid-cols-2">
              {['Unlimited staff & tables', 'QR menu ordering', 'Thermal bill printing', 'Reports & inventory'].map((t) => <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" strokeWidth={3} />{t}</li>)}
            </ul>
          </section>
        )}

        <Step n="1" title="Business details" sub="Shown on your bills and QR menu">
          {I('company_name', 'Company name', { required: true, icon: Building2, placeholder: 'e.g. Hotel Atithi' })}
          {I('business_name', 'Hotel / restaurant name', { icon: Store })}
          {I('phone', 'Business mobile', { required: true, inputMode: 'tel', icon: Phone, placeholder: '10-digit number' })}
          {I('gst_number', 'GST number (optional)', { icon: FileText })}
          <div className="sm:col-span-2">{I('address', 'Address', { required: true, icon: MapPin })}</div>
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3 sm:gap-4">
            {I('city', 'City', { required: true })}
            {I('state', 'State', { required: true })}
            <div className="col-span-2 sm:col-span-1">{I('pin_code', 'PIN code', { required: true, inputMode: 'numeric' })}</div>
          </div>
          <div className="sm:col-span-2"><ImagePicker label="Company logo (optional)" hint="You can change this any time in Settings." file={logo} onChange={setLogo} rounded="rounded-2xl" fit="object-contain bg-white" /></div>
        </Step>

        <Step n="2" title="Owner account" sub="You'll use this to sign in">
          {I('owner_name', 'Your full name', { required: true, icon: User })}
          {I('email', 'Email address', { type: 'email', required: true, autoComplete: 'username', icon: Mail, inputMode: 'email' })}
          {I('password', 'Password', { type: 'password', required: true, autoComplete: 'new-password', icon: Lock, hint: 'At least 8 characters, with letters and numbers' })}
          {I('password_confirmation', 'Confirm password', { type: 'password', required: true, autoComplete: 'new-password', icon: Lock })}
        </Step>

        <Button type="submit" size="lg" loading={busy} className="w-full">Create my workspace</Button>
        <p className="text-center text-sm text-muted">Already registered? <Link to="/login" className="inline-flex min-h-11 items-center px-1 font-extrabold text-brand">Sign in</Link></p>
      </form>
    </div>
  )
}
