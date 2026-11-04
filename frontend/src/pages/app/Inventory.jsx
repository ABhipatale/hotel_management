import { useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { dt } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { Badge, Button, Input, Modal, PageHeader, Select, Spinner, Table } from '../../components/ui'

export default function Inventory() {
  const toast = useToast()
  const { data, loading, reload, error } = useApi('/inventory')
  const [edit, setEdit] = useState(null)
  const [move, setMove] = useState(null)
  const [hist, setHist] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    try { edit.id ? await api.put(`/inventory/${edit.id}`, edit) : await api.post('/inventory', edit); toast.success('Saved'); setEdit(null); reload() } catch (x) { toast.error(x) }
  }
  const doMove = async (e) => {
    e.preventDefault()
    try { await api.post(`/inventory/${move.id}/move`, move); toast.success('Stock updated'); setMove(null); reload() } catch (x) { toast.error(x) }
  }
  const history = async (i) => { try { setHist({ item: i, rows: (await api.get(`/inventory/${i.id}/transactions`)).data }) } catch (e) { toast.error(e) } }

  if (error) return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>
  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title="Inventory" sub="Raw materials and stock levels" actions={<Button onClick={() => setEdit({ name: '', unit: 'kg', quantity: 0, min_quantity: 0 })}><Plus className="h-4 w-4" /> Add item</Button>} />
      <Table rows={data} columns={[
        { header: 'Item', render: (i) => <span className="flex items-center gap-2 font-medium">{i.low_stock && <AlertTriangle className="h-4 w-4 text-amber-500" />}{i.name}</span> },
        { header: 'In stock', render: (i) => <Badge tone={i.low_stock ? 'red' : 'green'}>{Number(i.quantity)} {i.unit}</Badge> },
        { header: 'Alert at', render: (i) => `${Number(i.min_quantity)} ${i.unit}` },
        { header: '', className: 'text-right', render: (i) => (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" onClick={() => setMove({ id: i.id, name: i.name, type: 'in', quantity: '', note: '' })}>Stock</Button>
            <Button size="sm" variant="ghost" onClick={() => history(i)}>History</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(i)}>Edit</Button>
          </div>
        ) },
      ]} />

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit item' : 'Add item'}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Input label="Name" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Input label="Unit" required value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
            {!edit.id && <Input label="Opening quantity" type="number" min="0" step="0.001" value={edit.quantity} onChange={(e) => setEdit({ ...edit, quantity: e.target.value })} />}
            <Input label="Low-stock alert level" type="number" min="0" step="0.001" value={edit.min_quantity} onChange={(e) => setEdit({ ...edit, min_quantity: e.target.value })} />
            <Button type="submit" className="w-full">Save</Button>
          </form>
        )}
      </Modal>

      <Modal open={!!move} onClose={() => setMove(null)} title={`Stock · ${move?.name}`}>
        {move && (
          <form onSubmit={doMove} className="space-y-3">
            <Select label="Action" value={move.type} onChange={(e) => setMove({ ...move, type: e.target.value })}><option value="in">Stock in (purchase)</option><option value="out">Stock out (used / wasted)</option><option value="adjust">Set exact quantity</option></Select>
            <Input label="Quantity" type="number" min="0" step="0.001" required value={move.quantity} onChange={(e) => setMove({ ...move, quantity: e.target.value })} />
            <Input label="Note" value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} />
            <Button type="submit" className="w-full">Update stock</Button>
          </form>
        )}
      </Modal>

      <Modal open={!!hist} onClose={() => setHist(null)} title={`History · ${hist?.item.name}`}>
        {hist && (hist.rows.length ? hist.rows.map((r) => <div key={r.id} className="flex justify-between border-b border-line py-2 text-sm last:border-0"><span><Badge tone={r.type === 'in' ? 'green' : r.type === 'out' ? 'red' : 'blue'}>{r.type}</Badge> {Number(r.quantity)} {r.note && <span className="text-muted">· {r.note}</span>}</span><span className="text-xs text-muted">{dt(r.created_at)}</span></div>) : <p className="py-8 text-center text-sm text-muted">No movements yet</p>)}
      </Modal>
    </>
  )
}
