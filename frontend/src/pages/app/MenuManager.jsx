import { useState } from 'react'
import Img from '../../components/Img'
import { compressImage } from '../../lib/image'
import { Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react'
import { api, toFormData } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useT } from '../../i18n'
import { Badge, Button, Card, Chips, Empty, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../../components/ui'

const BLANK = { code: '', category_id: '', name: '', description: '', price: '', gst_percent: 5, discount_percent: 0, is_veg: true, is_available: true, stock: '', offer_text: '', variants: [] }

export default function MenuManager() {
  const toast = useToast()
  const t = useT()
  const { company } = useAuth()
  const gstOn = company?.gst_enabled !== false
  const ask = useConfirm()
  const { data: cats, reload: reloadCats } = useApi('/menu/categories')
  const { data: items, loading, reload } = useApi('/menu/items')
  const [cat, setCat] = useState('all')
  const [edit, setEdit] = useState(null)
  const [image, setImage] = useState(null)
  const [catModal, setCatModal] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = (items || []).filter((i) => cat === 'all' || i.category_id === +cat)
  // New dishes are pre-filled with the next free product number (the owner can change it)
  const nextCode = Math.max(0, ...(items || []).map((i) => Number(i.code) || 0)) + 1
  const open = (i) => { setImage(null); setEdit(i ? { ...i, code: i.code ?? '', stock: i.stock ?? '', variants: i.variants.map((v) => ({ name: v.name, price: v.price })) } : { ...BLANK, code: nextCode, category_id: cats?.[0]?.id || '' }) }

  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      const body = toFormData({ ...edit, image, variants: undefined })
      edit.variants.forEach((v, i) => { body.append(`variants[${i}][name]`, v.name); body.append(`variants[${i}][price]`, v.price) })
      if (edit.id && !edit.variants.length) body.append('variants', '')
      // Items use POST for both create & update (multipart); stock may be cleared.
      if (edit.stock === '') body.delete('stock')
      await api.post(edit.id ? `/menu/items/${edit.id}` : '/menu/items', body)
      toast.success(t('Saved')); setEdit(null); reload(); reloadCats()
    } catch (x) { toast.error(x) } finally { setBusy(false) }
  }
  const del = async (i) => { if (await ask({ title: t('Delete {name}?', { name: i.name }), message: t('This dish will be removed from your menu and the QR menu.'), confirmText: t('Delete dish') })) { try { await api.delete(`/menu/items/${i.id}`); reload() } catch (e) { toast.error(e) } } }
  const toggle = async (i) => { try { await api.post(`/menu/items/${i.id}`, toFormData({ is_available: !i.is_available })); reload() } catch (e) { toast.error(e) } }
  const addCat = async () => { try { await api.post('/menu/categories', { name: newCat }); setNewCat(''); reloadCats() } catch (e) { toast.error(e) } }
  const delCat = async (c) => { try { await api.delete(`/menu/categories/${c.id}`); reloadCats() } catch (e) { toast.error(e) } }
  const s = (k) => (e) => setEdit({ ...edit, [k]: e.target.value })

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title={t('Menu')} sub={t('Categories, dishes, variants and prices')} actions={<><Button variant="secondary" onClick={() => setCatModal(true)}>{t('Categories')}</Button><Button onClick={() => open()}><Plus className="h-4 w-4" /> {t('Add dish')}</Button></>} />
      <Chips value={cat} onChange={setCat} items={[['all', t('All')], ...(cats || []).map((c) => [String(c.id), c.name])]} />

      {!rows.length ? <Empty title={t('No dishes yet')} action={<Button onClick={() => open()}>{t('Add your first dish')}</Button>} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((i) => (
            <Card key={i.id} className={`flex gap-3 ${i.is_available ? '' : 'opacity-60'}`}>
              {i.image_url ? <Img src={i.image_url} thumb className="h-20 w-20 shrink-0 rounded-xl object-cover" /> : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-brand-soft"><UtensilsCrossed className="h-7 w-7 text-brand/40" strokeWidth={1.6} /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">{i.code != null && <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-brand px-1.5 text-[11px] font-extrabold leading-none text-white">{i.code}</span>}<i className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} /><span className="truncate font-medium">{i.name}</span></div>
                <div className="text-xs text-muted">{i.category?.name}{gstOn ? ` · ${t('GST {n}%', { n: i.gst_percent })}` : ''}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5"><b className="text-brand">{money(i.price)}</b>{Number(i.discount_percent) > 0 && <Badge tone="green">{t('{n}% off', { n: i.discount_percent })}</Badge>}{i.variants.length > 0 && <Badge tone="violet">{t('{n} variants', { n: i.variants.length })}</Badge>}{i.stock !== null && <Badge tone={i.stock < 5 ? 'red' : 'slate'}>{t('stock {n}', { n: i.stock })}</Badge>}</div>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => toggle(i)}>{i.is_available ? t('Hide') : t('Show')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => open(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => del(i)}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('Edit dish') : t('Add dish')} wide>
        {edit && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Input label={t('Product number')} type="number" inputMode="numeric" min="1" max="99999" value={edit.code} onChange={s('code')} placeholder={t('Auto')} hint={t('Short number for fast ordering, e.g. 1 = Roti. Leave blank to auto-number.')} />
            <Input label={t('Name')} required value={edit.name} onChange={s('name')} />
            <Select label={t('Category')} required value={edit.category_id} onChange={s('category_id')}>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Input label={t('Price (₹)')} type="number" min="0" step="0.01" required value={edit.price} onChange={s('price')} />
            <Input label={t('GST %')} type="number" min="0" max="28" step="0.01" value={gstOn ? edit.gst_percent : ''} onChange={s('gst_percent')} disabled={!gstOn} placeholder={gstOn ? '' : t('GST is off')} />
            <Input label={t('Discount %')} type="number" min="0" max="100" value={edit.discount_percent} onChange={s('discount_percent')} />
            <Input label={t('Stock (blank = unlimited)')} type="number" min="0" value={edit.stock} onChange={s('stock')} />
            <Input label={t('Special offer text')} value={edit.offer_text || ''} onChange={s('offer_text')} />
            <Input label={t('Image')} type="file" accept="image/*" onChange={async (e) => setImage(await compressImage(e.target.files[0]))} />
            <div className="sm:col-span-2"><Textarea label={t('Description')} value={edit.description || ''} onChange={s('description')} /></div>
            <div className="flex gap-5 text-sm sm:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_veg} onChange={(e) => setEdit({ ...edit, is_veg: e.target.checked })} /> {t('Vegetarian')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_available} onChange={(e) => setEdit({ ...edit, is_available: e.target.checked })} /> {t('Available')}</label>
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted"><span>{t('Variants (e.g. Half / Full)')}</span><button type="button" className="text-brand" onClick={() => setEdit({ ...edit, variants: [...edit.variants, { name: '', price: '' }] })}>{t('+ Add')}</button></div>
              {edit.variants.map((v, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input className="min-h-12 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm flex-1" placeholder={t('Name')} required value={v.name} onChange={(e) => setEdit({ ...edit, variants: edit.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className="min-h-12 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm w-28" placeholder={t('Price')} type="number" required value={v.price} onChange={(e) => setEdit({ ...edit, variants: edit.variants.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} />
                  <button type="button" onClick={() => setEdit({ ...edit, variants: edit.variants.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-rose-600" /></button>
                </div>
              ))}
            </div>
            <Button type="submit" loading={busy} className="sm:col-span-2">{t('Save dish')}</Button>
          </form>
        )}
      </Modal>

      <Modal open={catModal} onClose={() => setCatModal(false)} title={t('Categories')}>
        <div className="space-y-2">
          {cats?.map((c) => <div key={c.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm"><span>{c.name} <span className="text-muted">({c.items_count})</span></span><button onClick={() => delCat(c)}><Trash2 className="h-4 w-4 text-rose-600" /></button></div>)}
          <div className="flex gap-2 pt-2"><input className="min-h-12 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm flex-1" placeholder={t('New category')} value={newCat} onChange={(e) => setNewCat(e.target.value)} /><Button onClick={addCat} disabled={!newCat}>{t('Add')}</Button></div>
        </div>
      </Modal>
    </>
  )
}
