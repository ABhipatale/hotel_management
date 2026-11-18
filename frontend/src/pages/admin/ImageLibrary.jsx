import { useState } from 'react'
import { AlertTriangle, ImagePlus, Search, Trash2, Upload } from 'lucide-react'
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
  // photos whose file is missing / empty on the server (they show as a broken image everywhere): found by the server, not guessed
  const { data: health, reload: recheck } = useApi('/admin/library/check')
  const [fixing, setFixing] = useState(false)
  const fix = async () => {
    setFixing(true)
    try { await api.post('/admin/library/repair'); reload(); await recheck(); toast.success(tr('Done')) } catch (e) { toast.error(e) } finally { setFixing(false) }
  }
  const broken = Object.fromEntries((health?.broken || []).map((b) => [b.id, b.reason]))
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
    } catch (e) { toast.error(e) } finally { setProgress(null); reload(); recheck() }
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
      toast.success(tr('Saved')); setEdit(null); reload(); recheck()
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!(await ask({ title: tr('Delete this photo?'), message: tr('Dishes using it go back to name matching or to no photo.'), confirmText: tr('Delete photo') }))) return
    try { await api.delete(`/admin/library/${edit.id}`); setEdit(null); reload(); recheck() } catch (e) { toast.error(e) }
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

      {health?.stranded > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <b>{tr('{n} photo(s) are saved on the server but not in the website folder.', { n: health.stranded })}</b>
            <p className="mt-1 text-xs leading-relaxed">{tr('Press "Fix now": nothing is deleted, the files are only copied to the right place.')}</p>
          </div>
          <Button loading={fixing} onClick={fix}>{tr('Fix now')}</Button>
        </div>
      )}
      {health?.broken?.some((b) => b.reason === 'missing') && (
        <div role="alert" className="mb-4 flex gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <b>{tr('{n} photo(s) are missing on the server.', { n: health.broken.filter((b) => b.reason === 'missing').length })}</b>
            <p className="mt-1 text-xs leading-relaxed">{tr('Open the tile marked "Missing" and use "Replace photo" to upload it again.')}</p>
          </div>
        </div>
      )}

      {loading ? <ListSkeleton /> : !data?.length ? <Empty title={tr('No photos yet')} /> : (
        <>
          <div className="mb-2 text-xs font-semibold text-muted">{tr('{n} photos', { n: data.length })}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.map((img) => (
              <button key={img.id} type="button" onClick={() => open(img)} className={`relative overflow-hidden rounded-2xl border bg-white text-left shadow-card transition active:scale-95 ${broken[img.id] === 'missing' ? 'border-rose-300 ring-2 ring-rose-200' : 'border-line/70'}`}>
                <Img src={img.image_url} thumb className="h-28 w-full object-cover" />
                {broken[img.id] === 'missing' && <span className="absolute left-2 top-2 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-card">{tr('Missing')}</span>}
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
            {broken[edit.id] === 'missing' && !file && <p className="rounded-2xl bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">{tr('This photo is missing on the server. Choose the picture again below and press Save.')}</p>}
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
