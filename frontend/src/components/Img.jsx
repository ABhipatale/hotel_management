import { useState } from 'react'
import { thumbOf } from '../lib/image'

/**
 * Picture that loads lazily, decodes off the main thread, shows a soft tinted box while loading,
 * and (with `thumb`) fetches the small version first-class, falling back to the full image if there is none.
 */
export default function Img({ src, thumb = false, className = '', alt = '', ...rest }) {
  const [url, setUrl] = useState(thumb ? thumbOf(src) : src)
  return (
    <img
      {...rest}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => { if (url !== src) setUrl(src) }}
      className={`${className} bg-brand-soft`}
    />
  )
}
