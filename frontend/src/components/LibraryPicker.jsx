import { useState } from 'react'
import { Search } from 'lucide-react'
import Img from './Img'
import { useApi } from '../lib/useApi'
import { useT } from '../i18n'
import { Modal, Spinner } from './ui'

/** Hotel side: choose one of the platform's ready-made dish photos. Mounted only while open. */
export default function LibraryPicker({ initialQuery = '', onClose, onPick }) {
  const t = useT()
  const { data, loading } = useApi('/library')
  const [q, setQ] = useState(initialQuery)
  const needle = q.trim().toLowerCase()
  const list = (data || []).filter((i) => !needle || [i.name, i.name_mr, i.aliases].some((x) => (x || '').toLowerCase().includes(needle)))

  return (
    <Modal open onClose={onClose} title={t('Library photos')} wide>
      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search photos')} className="min-h-12 w-full rounded-2xl border border-line bg-white px-4 pl-11 text-[16px] outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 sm:min-h-11 sm:text-sm" />
      </div>
      {loading ? <Spinner /> : !list.length ? (
        <p className="py-8 text-center text-sm text-muted">{data?.length ? t('No photo matches your search.') : t('No library photos yet. Upload your own photo instead.')}</p>
      ) : (
        <div className="grid max-h-[60dvh] grid-cols-3 gap-2.5 overflow-y-auto sm:grid-cols-4">
          {list.map((i) => (
            <button key={i.id} type="button" onClick={() => onPick(i)} className="overflow-hidden rounded-xl border border-line/70 bg-white text-left shadow-card transition active:scale-95">
              <Img src={i.image_url} thumb className="h-20 w-full object-cover" />
              <div className="px-2 py-1.5"><div className="truncate text-xs font-semibold">{i.name}</div>{i.name_mr && <div className="truncate text-[11px] text-muted">{i.name_mr}</div>}</div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
