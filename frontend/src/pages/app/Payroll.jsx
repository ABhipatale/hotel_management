import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, HandCoins, History, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dateOnly, money, today } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useI18n } from '../../i18n'
import { Badge, Button, Card, Empty, Input, ListSkeleton, Modal, PageHeader, Select, Stat } from '../../components/ui'

const JOBS = ['Cook', 'Waiter', 'Captain', 'Cleaner', 'Helper', 'Cashier', 'Manager', 'Driver']
const daysIn = (month) => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate() }
const shift = (month, by) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Staff salary & advances (pagar / uchal): fixed monthly salary, advances given, the monthly salary with absent days and advance deducted. */
export default function Payroll() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const ask = useConfirm()
  const nowMonth = today().slice(0, 7)
  const [month, setMonth] = useState(nowMonth)
  const { data, loading, reload } = useApi('/payroll/employees', { params: { month } })
  const [form, setForm] = useState(null)      // add / edit a person
  const [adv, setAdv] = useState(null)        // { emp, kind: 'advance' | 'repayment' }
  const [pay, setPay] = useState(null)        // emp
  const [hist, setHist] = useState(null)      // emp id
  const label = useMemo(() => new Date(`${month}-01T12:00:00`).toLocaleString(lang === 'mr' ? 'mr-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric' }), [month, lang])
  const tot = data?.totals

  return (
    <>
      <PageHeader title={t('Salary & advances')} sub={t('Monthly pay, advances (uchal) and deductions of your staff')} actions={<Button onClick={() => setForm({ name: '', job: '', phone: '', monthly_salary: '', join_date: '' })}><Plus className="h-4 w-4" /> {t('Add person')}</Button>} />

      <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl bg-white p-2 ring-1 ring-line">
        <button type="button" aria-label={t('Previous month')} onClick={() => setMonth(shift(month, -1))} className="grid h-11 w-11 place-items-center rounded-xl active:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
        <div className="text-center"><div className="text-base font-extrabold">{label}</div>{month !== nowMonth && <button type="button" onClick={() => setMonth(nowMonth)} className="text-xs font-semibold text-brand">{t('This month')}</button>}</div>
        <button type="button" aria-label={t('Next month')} disabled={month >= nowMonth} onClick={() => setMonth(shift(month, 1))} className="grid h-11 w-11 place-items-center rounded-xl active:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {loading ? <ListSkeleton /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3">
            <Stat label={t('Monthly salaries')} value={money(tot.monthly_salary)} icon={Wallet} />
            <Stat label={t('Paid this month')} value={money(tot.paid)} icon={Wallet} tone="green" />
            <Stat label={t('Still to pay')} value={money(tot.pending)} icon={Wallet} tone="amber" sub={t('{n} people', { n: tot.pending_count })} />
            <Stat label={t('Advances to recover')} value={money(tot.advance_balance)} icon={HandCoins} tone="red" />
          </div>

          {!data.employees.length ? <Empty icon={Wallet} title={t('No staff added yet')} hint={t('Add your cook, waiters, cleaners... with their monthly salary.')} /> : (
            <div className="space-y-3">
              {data.employees.map((e) => (
                <Card key={e.id} className={e.is_active ? '' : 'opacity-60'}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-extrabold">{e.name}</div>
                      <div className="text-xs text-muted">{[e.job && t(e.job), e.phone].filter(Boolean).join(' · ')}{!e.is_active && ` · ${t('Switched off')}`}</div>
                      <div className="mt-1 text-sm font-semibold">{money(e.monthly_salary)} <span className="text-xs font-medium text-muted">/ {t('month')}</span></div>
                      {e.is_active && !e.paid && e.balance > 0 && <div className="mt-0.5 text-sm font-extrabold text-brand">{t('Give in hand')}: {money(Math.max(0, e.monthly_salary - Math.min(e.balance, e.monthly_salary)))} <span className="text-xs font-medium text-muted">({t('after advance deducted')})</span></div>}
                    </div>
                    <div className="shrink-0 text-right">
                      {e.paid ? <Badge tone="green">{t('Paid')} {money(e.paid.amount)}</Badge> : e.is_active ? <Badge tone="amber">{t('Not paid yet')}</Badge> : null}
                      {e.balance > 0 && <div className="mt-1.5 text-xs font-bold text-rose-600">{t('Advance to recover')}: {money(e.balance)}</div>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {e.is_active && !e.paid && <Button size="sm" variant="accent" onClick={() => setPay(e)}>{t('Pay salary')}</Button>}
                    {e.is_active && <Button size="sm" variant="secondary" onClick={() => setAdv({ emp: e, kind: 'advance' })}>{t('Give advance')}</Button>}
                    {e.balance > 0 && <Button size="sm" variant="secondary" onClick={() => setAdv({ emp: e, kind: 'repayment' })}>{t('Got money back')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setHist(e.id)}><History className="h-4 w-4" /> {t('History')}</Button>
                    <Button size="sm" variant="ghost" aria-label={t('Edit')} onClick={() => setForm({ ...e, join_date: e.join_date?.slice(0, 10) || '' })}><Pencil className="h-4 w-4" /></Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <PersonForm form={form} onClose={() => setForm(null)} onDone={() => { setForm(null); reload() }} />
      <AdvanceForm adv={adv} onClose={() => setAdv(null)} onDone={() => { setAdv(null); reload() }} />
      <PayForm emp={pay} month={month} onClose={() => setPay(null)} onDone={() => { setPay(null); reload() }} />
      <History_ id={hist} onClose={() => setHist(null)} onChanged={reload} toast={toast} ask={ask} />
    </>
  )
}

function PersonForm({ form, onClose, onDone }) {
  const { t } = useI18n()
  const toast = useToast()
  const ask = useConfirm()
  const [f, setF] = useState(null)
  const cur = f && f.__id === (form?.id ?? 'new') ? f : form && { ...form, __id: form.id ?? 'new' }
  const set = (k) => (e) => setF({ ...cur, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    const body = { name: cur.name, job: cur.job || null, phone: cur.phone || null, monthly_salary: Number(cur.monthly_salary) || 0, join_date: cur.join_date || null }
    try {
      if (cur.id) await api.put(`/payroll/employees/${cur.id}`, { ...body, is_active: cur.is_active }); else await api.post('/payroll/employees', body)
      toast.success(t('Saved')); setF(null); onDone()
    } catch (x) { toast.error(x) }
  }
  const remove = async () => {
    if (!(await ask({ title: t('Remove {n}?', { n: cur.name }), message: t('A person with records is only switched off; their history stays.'), confirmText: t('Remove') }))) return
    try { await api.delete(`/payroll/employees/${cur.id}`); setF(null); onDone() } catch (x) { toast.error(x) }
  }
  return (
    <Modal open={!!form} onClose={onClose} title={form?.id ? t('Edit person') : t('Add person')}>
      {cur && (
        <form onSubmit={save} className="space-y-3">
          <Input label={t('Name')} required value={cur.name} onChange={set('name')} />
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{t('Work (cook, waiter...)')}</span><input list="jobs" className="min-h-12 w-full rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm" value={cur.job || ''} onChange={set('job')} /><datalist id="jobs">{JOBS.map((j) => <option key={j} value={j} label={t(j)} />)}</datalist></label>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Monthly salary (₹)')} type="number" min="0" step="1" inputMode="decimal" required value={cur.monthly_salary} onChange={set('monthly_salary')} />
            <Input label={t('Phone')} inputMode="tel" value={cur.phone || ''} onChange={set('phone')} />
          </div>
          <Input label={t('Joining date')} type="date" value={cur.join_date || ''} onChange={set('join_date')} />
          {cur.id && <Select label={t('Status')} value={cur.is_active ? '1' : '0'} onChange={(e) => setF({ ...cur, is_active: e.target.value === '1' })}><option value="1">{t('Working')}</option><option value="0">{t('Left / switched off')}</option></Select>}
          <Button type="submit" size="lg" className="w-full">{t('Save')}</Button>
          {cur.id && <Button type="button" variant="ghost" className="w-full" onClick={remove}><Trash2 className="h-4 w-4 text-rose-600" /> {t('Remove')}</Button>}
        </form>
      )}
    </Modal>
  )
}

/** Advance given (uchal) or money handed back. */
function AdvanceForm({ adv, onClose, onDone }) {
  const { t } = useI18n()
  const toast = useToast()
  const [v, setV] = useState({ amount: '', entry_date: today(), method: 'cash', note: '' })
  const [busy, setBusy] = useState(false)
  const give = adv?.kind === 'advance'
  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      await api.post(`/payroll/employees/${adv.emp.id}/${give ? 'advance' : 'repayment'}`, { ...v, amount: Number(v.amount), note: v.note || null })
      toast.success(t('Saved')); setV({ amount: '', entry_date: today(), method: 'cash', note: '' }); onDone()
    } catch (x) { toast.error(x) } finally { setBusy(false) }
  }
  return (
    <Modal open={!!adv} onClose={onClose} title={give ? t('Give advance') : t('Got money back')}>
      {adv && (
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted">{adv.emp.name}{adv.emp.balance > 0 && ` · ${t('Advance to recover')}: ${money(adv.emp.balance)}`}</p>
          <Input label={t('Amount (₹)')} type="number" min="1" step="1" inputMode="decimal" required autoFocus max={give ? undefined : adv.emp.balance} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Date')} type="date" required value={v.entry_date} onChange={(e) => setV({ ...v, entry_date: e.target.value })} />
            <Select label={t('Paid by')} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}><option value="cash">{t('Cash')}</option><option value="upi">UPI</option></Select>
          </div>
          <Input label={t('Note (optional)')} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>{t('Save')}</Button>
        </form>
      )}
    </Modal>
  )
}

/** Pay the month's salary: base - absent days + bonus, minus the advance recovered = cash to hand over. */
function PayForm({ emp, month, onClose, onDone }) {
  const { t } = useI18n()
  const toast = useToast()
  const [v, setV] = useState({ absent: '', bonus: '', recovery: null, method: 'cash', date: today() })
  const [busy, setBusy] = useState(false)
  if (!emp) return <Modal open={false} onClose={onClose} title="" />
  const days = daysIn(month)
  const cut = r2((emp.monthly_salary / days) * (Number(v.absent) || 0))
  const gross = Math.max(0, r2(emp.monthly_salary - cut + (Number(v.bonus) || 0)))
  const owed = Math.max(0, emp.balance)
  const rec = v.recovery === null ? Math.min(owed, gross) : Math.min(Number(v.recovery) || 0, owed, gross) // starts with the whole advance (as far as the salary allows); the owner can change it
  const net = r2(gross - rec)
  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      await api.post(`/payroll/employees/${emp.id}/salary`, { month, absent_days: Number(v.absent) || 0, bonus: Number(v.bonus) || 0, recovery: rec, method: v.method, entry_date: v.date })
      toast.success(t('Salary paid')); setV({ absent: '', bonus: '', recovery: null, method: 'cash', date: today() }); onDone()
    } catch (x) { toast.error(x) } finally { setBusy(false) }
  }
  const row = (l, val, cls = '') => <div className={`flex justify-between text-sm ${cls}`}><span>{l}</span><span className="font-semibold">{val}</span></div>
  return (
    <Modal open onClose={onClose} title={`${t('Pay salary')} · ${emp.name}`}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('Absent days')} type="number" min="0" max={days} step="0.5" inputMode="decimal" value={v.absent} onChange={(e) => setV({ ...v, absent: e.target.value })} />
          <Input label={t('Bonus (₹)')} type="number" min="0" step="1" inputMode="decimal" value={v.bonus} onChange={(e) => setV({ ...v, bonus: e.target.value })} />
        </div>
        {owed > 0 && <Input label={`${t('Recover advance (₹)')} · ${t('owes')} ${money(owed)}`} type="number" min="0" max={Math.min(owed, gross)} step="1" inputMode="decimal" value={v.recovery === null ? rec : v.recovery} onChange={(e) => setV({ ...v, recovery: e.target.value })} hint={t('Taken out of this salary. Leave less to recover the rest next month.')} />}
        <div className="space-y-1 rounded-2xl bg-slate-50 p-3 ring-1 ring-line">
          {row(t('Monthly salary'), money(emp.monthly_salary))}
          {cut > 0 && row(`${t('Absent')} (${v.absent} ${t('days')})`, `- ${money(cut)}`, 'text-rose-600')}
          {Number(v.bonus) > 0 && row(t('Bonus'), `+ ${money(Number(v.bonus))}`, 'text-emerald-700')}
          {rec > 0 && row(t('Advance deducted'), `- ${money(rec)}`, 'text-rose-600')}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2"><span className="text-sm font-bold">{t('Give in hand')}</span><span className="text-2xl font-extrabold text-brand">{money(net)}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('Date')} type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          <Select label={t('Paid by')} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}><option value="cash">{t('Cash')}</option><option value="upi">UPI</option></Select>
        </div>
        <Button type="submit" size="lg" variant="accent" className="w-full" loading={busy}>{t('Pay')} {money(net)}</Button>
      </form>
    </Modal>
  )
}

/** One person's ledger (newest first). A wrong line can be undone. */
function History_({ id, onClose, onChanged, toast, ask }) {
  const { t } = useI18n()
  const { data, loading, reload } = useApi(`/payroll/employees/${id}`, { skip: !id })
  const kind = (e) => (e.type === 'advance' ? t('Advance given') : e.type === 'repayment' ? t('Money returned') : `${t('Salary')} ${e.month}`)
  const undo = async (e) => {
    if (!(await ask({ title: t('Undo this entry?'), message: e.type === 'salary' ? t('The salary is removed from expenses and the advance deducted becomes due again.') : t('The balance is corrected.'), confirmText: t('Undo') }))) return
    try { await api.delete(`/payroll/entries/${e.id}`); reload(); onChanged() } catch (x) { toast.error(x) }
  }
  return (
    <Modal open={!!id} onClose={onClose} title={data ? `${data.name} · ${t('History')}` : t('History')}>
      {loading || !data ? <ListSkeleton rows={2} /> : (
        <div className="space-y-3">
          <div className="flex justify-between rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-line"><span>{t('Advance to recover')}</span><b className={data.balance > 0 ? 'text-rose-600' : ''}>{money(Math.max(0, data.balance))}</b></div>
          {!data.entries.length ? <p className="text-sm text-muted">{t('Nothing yet.')}</p> : data.entries.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-2 border-b border-line pb-2 text-sm last:border-0">
              <div className="min-w-0">
                <div className="font-semibold">{kind(e)}</div>
                <div className="text-xs text-muted">{dateOnly(e.entry_date)} · {e.method === 'upi' ? 'UPI' : t('Cash')}{e.note ? ` · ${e.note}` : ''}</div>
                {e.type === 'salary' && <div className="mt-0.5 text-xs text-muted">{money(e.base_salary)}{e.absent_deduction > 0 && ` − ${money(e.absent_deduction)} (${e.absent_days} ${t('days')})`}{e.bonus > 0 && ` + ${money(e.bonus)}`}{e.recovery > 0 && ` − ${money(e.recovery)} ${t('advance')}`}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <b className={e.type === 'repayment' ? 'text-emerald-700' : ''}>{money(e.amount)}</b>
                <button type="button" aria-label={t('Undo')} onClick={() => undo(e)} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 active:bg-rose-100"><Trash2 className="h-4 w-4 text-rose-600" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
