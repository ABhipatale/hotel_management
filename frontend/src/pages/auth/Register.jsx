import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Check, Store } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { api, errMsg, toFormData } from '../../lib/api'
import { money } from '../../lib/format'
import { Button, ErrorNote, Input } from '../../components/ui'

const EMPTY = {
  company_name: '', business_name: '', owner_name: '', phone: '', email: '', password: '', password_confirmation: '',
  address: '', city: '', state: '', pin_code: '', gst_number: '', plan_id: '',
}

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
    <div className="min-h-full bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-lg"><Store className="h-7 w-7" /></div>
          <h1 className="text-2xl font-semibold">Register your business</h1>
          <p className="text-sm text-muted">Set up your own hotel / restaurant workspace — free trial included</p>
        </div>

        <form onSubmit={submit} className="space-y-6 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7">
          <ErrorNote>{err}</ErrorNote>

          {plans[0] && (
            <section className="rounded-2xl border border-brand bg-brand-soft p-4">
              <div className="flex items-center justify-between"><span className="font-semibold">{plans[0].name} plan</span><Check className="h-4 w-4 text-brand" /></div>
              <div className="mt-1 text-lg font-semibold">{money(plans[0].price_monthly)}<span className="text-xs font-normal text-muted">/mo</span></div>
              <div className="mt-1 text-xs text-muted">{plans[0].trial_days}-day free trial · Unlimited staff &amp; tables · all features included</div>
            </section>
          )}

          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="text-sm font-semibold sm:col-span-2">Business details</h2>
            {I('company_name', 'Company name', { required: true })}
            {I('business_name', 'Hotel / restaurant name')}
            {I('phone', 'Business mobile number', { required: true, inputMode: 'tel' })}
            {I('gst_number', 'GST number (optional)')}
            <div className="sm:col-span-2">{I('address', 'Address', { required: true })}</div>
            {I('city', 'City', { required: true })}
            {I('state', 'State', { required: true })}
            {I('pin_code', 'PIN code', { required: true, inputMode: 'numeric' })}
            <Input label="Company logo" type="file" accept="image/*" onChange={(e) => setLogo(e.target.files[0])} error={errs.logo} />
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="text-sm font-semibold sm:col-span-2">Owner account</h2>
            {I('owner_name', 'Owner full name', { required: true })}
            {I('email', 'Email address', { type: 'email', required: true, autoComplete: 'username' })}
            {I('password', 'Password', { type: 'password', required: true, autoComplete: 'new-password', hint: 'Min 8 characters, with letters and numbers' })}
            {I('password_confirmation', 'Confirm password', { type: 'password', required: true, autoComplete: 'new-password' })}
          </section>

          <Button type="submit" size="lg" loading={busy} className="w-full">Create my workspace</Button>
          <p className="text-center text-sm text-muted">Already registered? <Link to="/login" className="font-medium text-brand">Sign in</Link></p>
        </form>
      </div>
    </div>
  )
}
