import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dateOnly, money, today } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { Button, Input, Modal, PageHeader, Spinner, Table } from '../../components/ui'

const CATS = ['Groceries', 'Salaries', 'Rent', 'Electricity', 'Gas', 'Maintenance', 'Marketing', 'Other']

export default function Expenses() {
  const toast = useToast()
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })
  const { data, loading, reload, error } = useApi('/expenses', { params: range })
  const [edit, setEdit] = useState(null)
  const total = (data || []).reduce((a, e) => a + Number(e.amount), 0)

  const save = async (e) => {
    e.preventDefault()
    try { await api.post('/expenses', edit); toast.success('Expense added'); setEdit(null); reload() } catch (x) { toast.error(x) }
  }
  const del = async (x) => { if (confirm('Delete this expense?')) { try { await api.delete(`/expenses/${x.id}`); reload() } catch (e) { toast.error(e) } } }

  return (
    <>
      <PageHeader title="Expenses" sub={`Total in range: ${money(total)}`} actions={<Button onClick={() => setEdit({ category: CATS[0], description: '', amount: '', expense_date: today() })}><Plus className="h-4 w-4" /> Add expense</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {error ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p> : loading ? <Spinner /> : (
        <Table rows={data} columns={[
          { header: 'Date', render: (x) => dateOnly(x.expense_date) },
          { header: 'Category', key: 'category' },
          { header: 'Description', render: (x) => x.description || '—' },
          { header: 'Amount', render: (x) => <b>{money(x.amount)}</b> },
          { header: '', className: 'text-right', render: (x) => <button onClick={() => del(x)}><Trash2 className="h-4 w-4 text-rose-600" /></button> },
        ]} />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Add expense">
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Category</span><input list="cats" required className="w-full rounded-xl border border-line px-3 py-2.5 text-sm" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /><datalist id="cats">{CATS.map((c) => <option key={c} value={c} />)}</datalist></label>
            <Input label="Amount (₹)" type="number" min="0.01" step="0.01" required value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
            <Input label="Date" type="date" required value={edit.expense_date} onChange={(e) => setEdit({ ...edit, expense_date: e.target.value })} />
            <Input label="Description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <Button type="submit" className="w-full">Save</Button>
          </form>
        )}
      </Modal>
    </>
  )
}
