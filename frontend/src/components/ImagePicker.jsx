import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'

/** Square upload tile with live preview. `current` is the saved URL; `onChange(file|null)` reports a new pick. */
export default function ImagePicker({ label, hint, current, file, onChange, onRemove, rounded = 'rounded-3xl', fit = 'object-cover' }) {
  const ref = useRef(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const src = preview || current
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-slate-600">{label}</div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={`group relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden border-2 border-dashed border-line bg-slate-50 transition hover:border-brand ${rounded}`}
        >
          {src ? <img src={src} alt="" className={`h-full w-full ${fit}`} /> : <ImagePlus className="h-7 w-7 text-slate-400 group-hover:text-brand" />}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => ref.current?.click()} className="rounded-xl bg-brand-soft px-3.5 py-2 text-xs font-semibold text-brand">{src ? 'Change' : 'Upload'}</button>
            {(file || (current && onRemove)) && (
              <button type="button" onClick={() => (file ? onChange(null) : onRemove())} className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 ring-1 ring-line">
                <X className="h-3.5 w-3.5" /> {file ? 'Cancel' : 'Remove'}
              </button>
            )}
          </div>
          {hint && <p className="text-[11px] leading-snug text-muted">{hint}</p>}
        </div>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onChange(e.target.files[0] || null)} />
      </div>
    </div>
  )
}
