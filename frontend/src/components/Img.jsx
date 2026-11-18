import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { devUrl, thumbOf } from '../lib/image'

/**
 * Picture that loads lazily, decodes off the main thread, shows a soft tinted box while loading,
 * and (with `thumb`) fetches the small version first-class, falling back to the full image if there is none.
 * If the picture cannot be shown at all (a missing / damaged file), a neat blank tile is shown, never the browser's broken-image icon.
 */
export default function Img({ src: raw, thumb = false, className = '', alt = '', ...rest }) {
  const src = devUrl(raw)
  const [url, setUrl] = useState(thumb ? thumbOf(src) : src)
  const [bad, setBad] = useState(false)
  if (bad) {
    return <div role="img" aria-label={alt} className={`${className} grid place-items-center bg-brand-soft`}><ImageOff className="h-6 w-6 text-brand/30" strokeWidth={1.6} /></div>
  }

  return (
    <img
      {...rest}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => { if (url !== src) setUrl(src); else setBad(true) }}
      className={`${className} bg-brand-soft`}
    />
  )
}
