import { useEffect, useMemo, useState } from 'react'
import Img from '../../components/Img'
import LibraryPicker from '../../components/LibraryPicker'
import { compressImage } from '../../lib/image'
import { ArrowDown, ArrowUp, ChevronsUp, Download, ImageIcon, Pencil, Plus, Trash2, Upload, UtensilsCrossed } from 'lucide-react'
import { api, toFormData } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { money } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useI18n } from '../../i18n'
import { catName, dishNames } from '../../lib/dishName'
import { Badge, Button, Card, Chips, Empty, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../../components/ui'

const BLANK = { code: '', category_id: '', name: '', name_mr: '', description: '', price: '', gst_percent: 5, discount_percent: 0, is_veg: true, is_available: true, stock: '', offer_text: '', variants: [] }

const SAMPLE_CSV = [
  'product_number,name,marathi_name,category,category_marathi,price,gst_percent,discount_percent,veg,available,stock,description,offer_text',
  '101,Roti,चपाती,Breads,रोटी,20,5,0,yes,yes,,Fresh tandoor roti,',
  '102,Bhaji,भाजी,Main Course,मेन कोर्स,60,5,0,yes,yes,50,"Seasonal vegetable, home style",',
  '103,Chicken Biryani,चिकन बिर्याणी,Rice,भात,220,5,10,no,yes,,Served with raita,Lunch special',
  ',Masala Tea,मसाला चहा,Beverages,पेये,15,5,0,yes,yes,,,',
].join('\n')

/** Dish photo: own upload, a platform library photo, or none. The platform photo that matches the dish name is the automatic default. */
function DishPhoto({ edit, setEdit, file, setFile, library }) {
  const { t } = useI18n()
  const [picking, setPicking] = useState(false)
  const own = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (own) URL.revokeObjectURL(own) }, [own])
  const shown = own || edit.image_url
  const source = own ? 'own' : edit.image_source
  const auto = !own && edit.image_action === 'auto'
  const label = source === 'own' ? t('Your own photo') : source === 'library' ? t('Platform photo') : auto ? t('Automatic: a platform photo is used when one matches the dish name.') : t('No photo')

  const pick = (img) => { setFile(null); setEdit({ ...edit, library_image_id: img.id, image_url: img.image_url, image_source: 'library', image_action: undefined }); setPicking(false) }
  const clear = (action) => { setFile(null); setEdit({ ...edit, library_image_id: null, image_url: null, image_source: null, image_action: action }) }

  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="text-sm font-medium">{t('Dish photo')}</div>
      <div className="flex gap-3 rounded-2xl border border-line bg-white p-3">
        {shown ? <Img src={shown} thumb={!own} className="h-24 w-24 shrink-0 rounded-xl object-cover" /> : <div className="grid h-24 w-24 shrink-0 place-items-center rounded-xl bg-brand-soft"><UtensilsCrossed className="h-8 w-8 text-brand/40" strokeWidth={1.6} /></div>}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-xs font-semibold text-muted">{label}</div>
          <div className="flex flex-wrap gap-2">
            {library && <Button type="button" size="sm" variant="secondary" onClick={() => setPicking(true)}><ImageIcon className="h-4 w-4" /> {t('Choose from library')}</Button>}
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-xs font-bold active:scale-95">
              <Upload className="h-4 w-4" /> {t('Upload own photo')}
              <input type="file" accept="image/*" hidden onChange={async (e) => { if (e.target.files[0]) { setFile(await compressImage(e.target.files[0])); setEdit({ ...edit, library_image_id: null, image_action: undefined }) } e.target.value = '' }} />
            </label>
            {(shown || source) && <Button type="button" size="sm" variant="ghost" onClick={() => clear('remove')}><Trash2 className="h-4 w-4 text-rose-600" /> {t('Remove photo')}</Button>}
            {library && (source === 'own' || edit.image_action === 'remove') && edit.id && <Button type="button" size="sm" variant="ghost" onClick={() => clear('auto')}>{t('Use platform photo automatically')}</Button>}
          </div>
        </div>
      </div>
      {picking && <LibraryPicker initialQuery="" onClose={() => setPicking(false)} onPick={pick} />}
    </div>
  )
}

function downloadSample() {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + SAMPLE_CSV + '\n'], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'menu-sample.csv' })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function MenuManager() {
  const toast = useToast()
  const { t, lang } = useI18n()
  const { company } = useAuth()
  const gstOn = company?.gst_enabled !== false
  const libraryOn = company?.use_library_images !== false
  const ask = useConfirm()
  const { data: cats, reload: reloadCats } = useApi('/menu/categories')
  const { data: items, loading, reload } = useApi('/menu/items')
  const [cat, setCat] = useState('all')
  const [edit, setEdit] = useState(null)
  const [image, setImage] = useState(null)
  const [catModal, setCatModal] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newCatMr, setNewCatMr] = useState('')
  const [editCat, setEditCat] = useState(null)
  const [busy, setBusy] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvFile, setCsvFile] = useState(null)
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvRes, setCsvRes] = useState(null)

  const rows = (items || []).filter((i) => cat === 'all' || i.category_id === +cat)
  // New dishes are pre-filled with the next free product number (the owner can change it)
  const nextCode = Math.max(0, ...(items || []).map((i) => Number(i.code) || 0)) + 1
  const open = (i) => { setImage(null); setEdit(i ? { ...i, code: i.code ?? '', name_mr: i.name_mr ?? '', stock: i.stock ?? '', variants: i.variants.map((v) => ({ name: v.name, price: v.price })) } : { ...BLANK, code: nextCode, category_id: cats?.[0]?.id || '' }) }

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
  const uploadCsv = async () => {
    setCsvBusy(true)
    try {
      const body = new FormData(); body.append('file', csvFile)
      const { data } = await api.post('/menu/import', body)
      setCsvRes(data); setCsvFile(null); reload(); reloadCats()
    } catch (x) { toast.error(x) } finally { setCsvBusy(false) }
  }
  const del = async (i) => { if (await ask({ title: t('Delete {name}?', { name: i.name }), message: t('This dish will be removed from your menu and the QR menu.'), confirmText: t('Delete dish') })) { try { await api.delete(`/menu/items/${i.id}`); reload() } catch (e) { toast.error(e) } } }
  const toggle = async (i) => { try { await api.post(`/menu/items/${i.id}`, toFormData({ is_available: !i.is_available })); reload() } catch (e) { toast.error(e) } }
  const addCat = async () => { try { await api.post('/menu/categories', { name: newCat, name_mr: newCatMr || null }); setNewCat(''); setNewCatMr(''); reloadCats() } catch (e) { toast.error(e) } }
  const saveCat = async () => { try { await api.put(`/menu/categories/${editCat.id}`, { name: editCat.name, name_mr: editCat.name_mr || null }); setEditCat(null); reloadCats(); reload() } catch (e) { toast.error(e) } }
  // Arrange categories: the new order is saved at once and used on New order, Menu and the customer QR menu
  const moveCat = async (from, to) => {
    const ids = cats.map((c) => c.id)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    try { await api.post('/menu/categories/reorder', { ids }); reloadCats() } catch (e) { toast.error(e) }
  }
  const delCat = async (c) => { try { await api.delete(`/menu/categories/${c.id}`); reloadCats() } catch (e) { toast.error(e) } }
  const s = (k) => (e) => setEdit({ ...edit, [k]: e.target.value })

  if (loading) return <Spinner />
  return (
    <>
      <PageHeader title={t('Menu')} sub={t('Categories, dishes, variants and prices')} actions={<><Button variant="secondary" onClick={() => { setCsvRes(null); setCsvFile(null); setCsvOpen(true) }}><Upload className="h-4 w-4" /> {t('Import CSV')}</Button><Button variant="secondary" onClick={() => setCatModal(true)}>{t('Categories')}</Button><Button onClick={() => open()}><Plus className="h-4 w-4" /> {t('Add dish')}</Button></>} />
      <Chips value={cat} onChange={setCat} items={[['all', t('All')], ...(cats || []).map((c) => [String(c.id), catName(c, lang)])]} />

      {!rows.length ? <Empty title={t('No dishes yet')} action={<Button onClick={() => open()}>{t('Add your first dish')}</Button>} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((i) => (
            <Card key={i.id} className={`flex gap-3 ${i.is_available ? '' : 'opacity-60'}`}>
              {i.image_url ? <Img src={i.image_url} thumb className="h-20 w-20 shrink-0 rounded-xl object-cover" /> : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-brand-soft"><UtensilsCrossed className="h-7 w-7 text-brand/40" strokeWidth={1.6} /></div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">{i.code != null && <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-brand px-1.5 text-[11px] font-extrabold leading-none text-white">{i.code}</span>}<i className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${i.is_veg ? 'border-emerald-600 bg-emerald-500' : 'border-rose-600 bg-rose-500'}`} /><span className="truncate font-medium">{dishNames(i, lang).main}</span></div>
                {dishNames(i, lang).sub && <div className="truncate text-xs text-muted">{dishNames(i, lang).sub}</div>}
                <div className="text-xs text-muted">{catName(i.category, lang)}{gstOn ? ` · ${t('GST {n}%', { n: i.gst_percent })}` : ''}</div>
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
            <Input label={t('Marathi name (optional)')} lang="mr" value={edit.name_mr || ''} onChange={s('name_mr')} placeholder="उदा. भाकरी" />
            <Select label={t('Category')} required value={edit.category_id} onChange={s('category_id')}>{cats?.map((c) => <option key={c.id} value={c.id}>{catName(c, lang)}</option>)}</Select>
            <Input label={t('Price (₹)')} type="number" min="0" step="0.01" required value={edit.price} onChange={s('price')} />
            <Input label={t('GST %')} type="number" min="0" max="28" step="0.01" value={gstOn ? edit.gst_percent : ''} onChange={s('gst_percent')} disabled={!gstOn} placeholder={gstOn ? '' : t('GST is off')} />
            <Input label={t('Discount %')} type="number" min="0" max="100" value={edit.discount_percent} onChange={s('discount_percent')} />
            <Input label={t('Stock (blank = unlimited)')} type="number" min="0" value={edit.stock} onChange={s('stock')} />
            <Input label={t('Special offer text')} value={edit.offer_text || ''} onChange={s('offer_text')} />
            <DishPhoto edit={edit} setEdit={setEdit} file={image} setFile={setImage} library={libraryOn} />
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

      <Modal open={csvOpen} onClose={() => setCsvOpen(false)} title={t('Upload menu from CSV')} wide>
        <div className="space-y-4">
          <ol className="space-y-1.5 text-sm text-muted">
            <li><b className="text-ink">1.</b> {t('Download the sample file and open it in Excel or Google Sheets.')}</li>
            <li><b className="text-ink">2.</b> {t('Replace the sample rows with your dishes (one dish per row) and save as CSV.')}</li>
            <li><b className="text-ink">3.</b> {t('Upload it here. A row with an existing product number updates that dish; other rows add new dishes. Blank product number = auto-number.')}</li>
          </ol>
          <Button variant="secondary" className="w-full" onClick={downloadSample}><Download className="h-4 w-4" /> {t('Download sample CSV')}</Button>
          <div className="rounded-2xl bg-canvas p-3 text-xs text-muted ring-1 ring-line">
            <b className="text-ink">{t('Columns')}:</b> product_number, name*, marathi_name, category*, category_marathi, price*, gst_percent, discount_percent, veg (yes/no), available (yes/no), stock, description, offer_text
            <div className="mt-1">* {t('required. New categories are created automatically.')}</div>
          </div>
          <Input label={t('Choose CSV file')} type="file" accept=".csv,text/csv" onChange={(e) => { setCsvFile(e.target.files[0] || null); setCsvRes(null) }} />
          <Button className="w-full" disabled={!csvFile} loading={csvBusy} onClick={uploadCsv}><Upload className="h-4 w-4" /> {t('Upload dishes')}</Button>
          {csvRes && (
            <div className="space-y-2">
              <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{t('{c} added, {u} updated, {s} skipped', { c: csvRes.created, u: csvRes.updated, s: csvRes.skipped })}</div>
              {csvRes.errors.length > 0 && (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-2xl bg-rose-50 p-3 text-xs text-rose-800">
                  <div className="font-bold">{t('These rows were not imported:')}</div>
                  {csvRes.errors.map((e) => <div key={e.row}>{t('Line {n}', { n: e.row })}: {e.message}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal open={catModal} onClose={() => setCatModal(false)} title={t('Categories')}>
        <div className="space-y-2">
          <p className="text-xs text-muted">{t('Use the arrows to arrange the order. It is used on New order, the Menu and the QR menu.')}</p>
          {cats?.map((c, i) => (
            editCat?.id === c.id ? (
              <div key={c.id} className="space-y-2 rounded-xl border border-brand bg-brand-soft/40 p-2">
                <input className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-[16px] outline-none focus:border-brand sm:text-sm" placeholder={t('Category name (English)')} value={editCat.name} onChange={(e) => setEditCat({ ...editCat, name: e.target.value })} />
                <input lang="mr" className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-[16px] outline-none focus:border-brand sm:text-sm" placeholder={t('Marathi name (optional)')} value={editCat.name_mr || ''} onChange={(e) => setEditCat({ ...editCat, name_mr: e.target.value })} />
                <div className="grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setEditCat(null)}>{t('Cancel')}</Button><Button onClick={saveCat} disabled={!editCat.name}>{t('Save')}</Button></div>
              </div>
            ) : (
            <div key={c.id} className="flex items-center gap-1 rounded-xl border border-line py-1 pl-3 pr-1 text-sm">
              <span className="min-w-0 flex-1"><span className="block truncate">{c.name} <span className="text-muted">({c.items_count})</span></span>{c.name_mr && <span className="block truncate text-xs text-muted">{c.name_mr}</span>}</span>
              <button type="button" aria-label={t('Edit')} title={t('Edit')} onClick={() => setEditCat({ id: c.id, name: c.name, name_mr: c.name_mr || '' })} className="grid h-10 w-10 place-items-center rounded-lg active:bg-brand-soft"><Pencil className="h-4 w-4" /></button>
              <button type="button" disabled={i === 0} aria-label={t('Move to top')} title={t('Move to top')} onClick={() => moveCat(i, 0)} className="grid h-10 w-10 place-items-center rounded-lg text-brand active:bg-brand-soft disabled:opacity-25"><ChevronsUp className="h-5 w-5" /></button>
              <button type="button" disabled={i === 0} aria-label={t('Move up')} title={t('Move up')} onClick={() => moveCat(i, i - 1)} className="grid h-10 w-10 place-items-center rounded-lg active:bg-brand-soft disabled:opacity-25"><ArrowUp className="h-5 w-5" /></button>
              <button type="button" disabled={i === cats.length - 1} aria-label={t('Move down')} title={t('Move down')} onClick={() => moveCat(i, i + 1)} className="grid h-10 w-10 place-items-center rounded-lg active:bg-brand-soft disabled:opacity-25"><ArrowDown className="h-5 w-5" /></button>
              <button type="button" aria-label={t('Delete')} onClick={() => delCat(c)} className="grid h-10 w-10 place-items-center rounded-lg active:bg-rose-50"><Trash2 className="h-4 w-4 text-rose-600" /></button>
            </div>
            )
          ))}
          <div className="space-y-2 pt-2">
            <input className="min-h-12 w-full rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm" placeholder={t('New category')} value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <div className="flex gap-2"><input lang="mr" className="min-h-12 min-w-0 flex-1 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm" placeholder={t('Marathi name (optional)')} value={newCatMr} onChange={(e) => setNewCatMr(e.target.value)} /><Button onClick={addCat} disabled={!newCat}>{t('Add')}</Button></div>
          </div>
        </div>
      </Modal>
    </>
  )
}
