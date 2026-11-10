import { useState } from 'react'
import { ImagePlus, Search, Trash2, Upload } from 'lucide-react'
import Img from '../../components/Img'
import { api } from '../../lib/api'
import { compressImage } from '../../lib/image'
import { useApi } from '../../lib/useApi'
import { useT } from '../../i18n'
import { useToast } from '../../context/ToastContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Button, Empty, Input, Modal, PageHeader, ListSkeleton } from '../../components/ui'

/**
 * Platform admin: the shared dish-photo library. A dish in ANY hotel that has no photo of its own shows the library photo
 * whose name matches the dish name (word order and brackets are ignored). Hotels can also pick one by hand.
 */
export default function ImageLibrary() {
  const toast = useToast()
  const tr = useT()
  const ask = useConfirm()
  const [q, setQ] = useState('')
  const { data, loading, reload } = useApi('/admin/library', { params: { search: q } })
  const [progress, setProgress] = useState(null)
  const [edit, setEdit] = useState(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  const upload = async (files) => {
    const list = [...files]
    if (!list.length) return
    let created = 0
    let replaced = 0
    setProgress({ done: 0, total: list.length })
    try {
      // small batches: weak connections and PHP's per-request file limit
      for (let i = 0; i < list.length; i += 8) {
        const body = new FormData()
        for (const f of list.slice(i, i + 8)) body.append('files[]', await compressImage(f, 1000, 0.85))
        const { data: r } = await api.post('/admin/library', body)
        created += r.created
        replaced += r.replaced
        setProgress({ done: Math.min(i + 8, list.length), total: list.length })
      }
      toast.success(tr('{c} added, {r} replaced', { c: created, r: replaced }))
    } catch (e) { toast.error(e) } finally { setProgress(null); reload() }
  }

  const open = (img) => { setFile(null); setEdit({ ...img, name_mr: img.name_mr || '', aliases: img.aliases || '' }) }
  const save = async () => {
    setBusy(true)
    try {
      // empty strings are sent on purpose: they clear the Marathi name / spellings
      const body = new FormData()
      body.append('name', edit.name)
      body.append('name_mr', edit.name_mr)
      body.append('aliases', edit.aliases)
      if (file) body.append('image', file)
      await api.post(`/admin/library/${edit.id}`, body)
      toast.success(tr('Saved')); setEdit(null); reload()
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!(await ask({ title: tr('Delete this photo?'), message: tr('Dishes using it go back to name matching or to no photo.'), confirmText: tr('Delete photo') }))) return
    try { await api.delete(`/admin/library/${edit.id}`); setEdit(null); reload() } catch (e) { toast.error(e) }
  }

  return (
    <>
      <PageHeader
        title="Image library"
        sub="Dish photos shared with every hotel. A hotel's own photo always wins."
        actions={(
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl bg-brand px-4 text-sm font-bold text-white active:scale-95">
            <Upload className="h-4 w-4" /> {progress ? tr('Uploading {done}/{total}…', progress) : tr('Upload photos')}
            <input type="file" accept="image/*" multiple hidden disabled={!!progress} onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
          </label>
        )}
      />
      <p className="mb-4 rounded-2xl bg-canvas px-4 py-3 text-xs text-muted ring-1 ring-line">{tr('Name each file like the dish, e.g. paneer-butter-masala.jpg: the dish name is taken from the file name. Uploading the same name again replaces that photo.')}</p>
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search photos')} className="min-h-12 w-full rounded-2xl border border-line bg-white px-4 pl-11 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm" />
      </div>

      {loading ? <ListSkeleton /> : !data?.length ? <Empty title={tr('No photos yet')} /> : (
        <>
          <div className="mb-2 text-xs font-semibold text-muted">{tr('{n} photos', { n: data.length })}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.map((img) => (
              <button key={img.id} type="button" onClick={() => open(img)} className="overflow-hidden rounded-2xl border border-line/70 bg-white text-left shadow-card transition active:scale-95">
                <Img src={img.image_url} thumb className="h-28 w-full object-cover" />
                <div className="p-2.5">
                  <div className="truncate text-sm font-semibold">{img.name}</div>
                  <div className="truncate text-xs text-muted">{img.name_mr || ' '}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.name}>
        {edit && (
          <div className="space-y-3">
            <Img src={file ? URL.createObjectURL(file) : edit.image_url} className="mx-auto h-48 w-full rounded-2xl object-cover" />
            <Input label={tr('Photo name (English)')} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Input label={tr('Marathi name (optional)')} value={edit.name_mr} onChange={(e) => setEdit({ ...edit, name_mr: e.target.value })} />
            <Input label={tr('Other spellings (comma separated)')} value={edit.aliases} onChange={(e) => setEdit({ ...edit, aliases: e.target.value })} placeholder="PBM, paneer makhani" hint={tr('A dish with any of these names also shows this photo.')} />
            <Input label={tr('Replace photo')} type="file" accept="image/*" onChange={async (e) => setFile(e.target.files[0] ? await compressImage(e.target.files[0], 1000, 0.85) : null)} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="danger" onClick={del}><Trash2 className="h-4 w-4" /> {tr('Delete photo')}</Button>
              <Button loading={busy} onClick={save}><ImagePlus className="h-4 w-4" /> {tr('Save')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
