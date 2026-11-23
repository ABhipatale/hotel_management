import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dt } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useCounter } from '../../context/CounterContext'
import { useAuth } from '../../context/AuthContext'
import { useT } from '../../i18n'
import { Badge, Button, Input, Modal, PageHeader, Select, Spinner, Table } from '../../components/ui'

const BLANK = { name: '', email: '', phone: '', password: '', role: 'waiter' }

export default function Staff() {
  const t = useT()
  const { multi, counters, nameOf } = useCounter()
  const { company } = useAuth()
  const ROLES = [...(multi ? ['counter'] : []), 'waiter', 'captain', ...(company?.kot_enabled && company?.kot_screen !== false ? ['chef'] : [])]
  const active = counters.filter((c) => c.is_active)
  const toast = useToast()
  const ask = useConfirm()
  const { data, loading, reload } = useApi('/staff')
  const [edit, setEdit] = useState(null)
  const [log, setLog] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    const body = { ...edit }
    if (multi) {
      delete body.branch_id
      const bIds = edit.branch_ids?.length ? edit.branch_ids : []
      if (!bIds.length) {
        toast.error(t('Choose at least one counter.'))
        return
      }
      body.branch_ids = bIds
    } else {
      delete body.branch_ids
      delete body.branch_id
    }
    if (!body.password) delete body.password
    try {
      if (edit.id) {
        await api.put(`/staff/${edit.id}`, body)
      } else {
        await api.post('/staff', body)
      }
      toast.success(t('Saved')); setEdit(null); reload()
    } catch (x) { toast.error(x) }
  }
  const toggle = async (u) => { try { await api.put(`/staff/${u.id}`, { is_active: !u.is_active }); reload() } catch (e) { toast.error(e) } }
  const remove = async (u) => { if (await ask({ title: t('Delete {name}?', { name: u.name }), message: 'They will no longer be able to sign in.', confirmText: 'Delete staff' })) { try { await api.delete(`/staff/${u.id}`); reload() } catch (e) { toast.error(e) } } }
  const activity = async (u) => { try { setLog({ user: u, rows: (await api.get(`/staff/${u.id}/activity`)).data }) } catch (e) { toast.error(e) } }
  const s = (k) => (e) => setEdit({ ...edit, [k]: e.target.value })

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Staff" sub="Accounts that can sign in to your company" actions={<Button onClick={() => setEdit({ ...BLANK, role: multi ? 'counter' : 'waiter', branch_ids: multi ? (active[0] ? [active[0].id] : []) : undefined })}><Plus className="h-4 w-4" /> Add staff</Button>} />
      <Table rows={data} columns={[
        { header: 'Name', render: (u) => <div><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></div> },
        { header: 'Role', render: (u) => <Badge tone={u.role === 'owner' || u.role === 'captain' ? 'violet' : u.role === 'counter' ? 'green' : u.role === 'chef' ? 'amber' : 'blue'}>{u.role === 'counter' ? 'counter manager' : u.role}</Badge> },
        ...(multi ? [{
          header: 'Counter',
          render: (u) => (
            u.role === 'owner' ? (
              <span className="text-muted">{t('All counters')}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold">
                {u.branch_ids?.length
                  ? u.branch_ids.map((b) => nameOf(b)).filter(Boolean).join(', ')
                  : (nameOf(u.branch_id) || counters.find((c) => c.is_default)?.name)}
              </span>
            )
          ),
        }] : []),
        { header: 'Last login', render: (u) => dt(u.last_login_at) },
        { header: 'Status', render: (u) => <Badge tone={u.is_active ? 'green' : 'slate'}>{u.is_active ? 'active' : 'disabled'}</Badge> },
        { header: '', className: 'text-right', render: (u) => u.role === 'owner' ? null : (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => activity(u)}>Activity</Button>
            <Button size="sm" variant="secondary" onClick={() => setEdit({ ...u, password: '', branch_ids: u.branch_ids?.length ? u.branch_ids : (u.branch_id ? [u.branch_id] : (active[0] ? [active[0].id] : [])) })}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.is_active ? 'Disable' : 'Enable'}</Button>
            <Button size="sm" variant="ghost" className="!text-rose-600 hover:!bg-rose-50" onClick={() => remove(u)}>Delete</Button>
          </div>
        ) },
      ]} />

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit staff' : 'Add staff'}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Input label="Full name" required value={edit.name} onChange={s('name')} />
            <Input label="Login email" type="email" required value={edit.email} onChange={s('email')} />
            <Input label="Mobile" value={edit.phone || ''} onChange={s('phone')} />
            <Input label={edit.id ? 'New password (leave blank to keep)' : 'Password'} type="password" required={!edit.id} value={edit.password} onChange={s('password')} hint="At least 6 characters (a 6-digit PIN is fine)" autoComplete="new-password" />
            <Select label="Role" value={edit.role} onChange={s('role')}>{ROLES.map((r) => <option key={r} value={r}>{r === 'counter' ? t('Counter manager') : r === 'chef' ? t('Chef (kitchen screen only)') : t(r)}</option>)}</Select>
            {multi && (
              <div>
                <div className="mb-1.5 text-sm font-semibold">
                  {edit.role === 'chef' ? t('Counters this chef cooks for') : t('Counters this staff member works on')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {active.map((c) => {
                    const ids = edit.branch_ids || []
                    const on = ids.includes(c.id)
                    const isMain = on && edit.role !== 'chef' && ids[0] === c.id
                    const toggle = () => {
                      if (on) {
                        if (ids.length <= 1) {
                          toast.error(t('Choose at least one counter.'))
                          return
                        }
                        setEdit({ ...edit, branch_ids: ids.filter((x) => x !== c.id) })
                      } else {
                        setEdit({ ...edit, branch_ids: [...ids, c.id] })
                      }
                    }
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={toggle}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold ring-1 transition active:scale-95 ${on ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-line'}`}
                      >
                        {on && <Check className="h-4 w-4" />}
                        {c.name}
                        {isMain && (
                          <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-normal tracking-wide">
                            {t('Main')}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {edit.role === 'chef'
                    ? t('Tickets from all the chosen counters appear on this chef\'s kitchen screen.')
                    : t('Staff can switch between the chosen counters from the top bar. The first chosen is their main counter.')}
                </p>
              </div>
            )}
            <Button type="submit" className="w-full">Save</Button>
          </form>
        )}
      </Modal>

      <Modal open={!!log} onClose={() => setLog(null)} title={t('Activity · {name}', { name: log?.user.name })} wide>
        {log && (log.rows.length ? log.rows.map((r) => <div key={r.id} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span>{r.action}</span><span className="text-xs text-muted">{dt(r.created_at)}</span></div>) : <p className="py-8 text-center text-sm text-muted">{t('No recorded activity')}</p>)}
      </Modal>
    </>
  )
}
