import { useState } from 'react'
import { thumbOf } from '../lib/image'

/**
 * Picture that loads lazily, decodes off the main thread, shows a soft placeholder while loading,
 * and (with `thumb`) fetches the small version first-class, falling back to the full image if there is none.
 */
export default function Img({ src, thumb = false, className = '', alt = '', ...rest }) {
  const [url, setUrl] = useState(thumb ? thumbOf(src) : src)
  const [ready, setReady] = useState(false)
  return (
    <img
      {...rest}
      ref={(el) => { if (el?.complete && el.naturalWidth) setReady(true) }}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setReady(true)}
      onError={() => { if (url !== src) setUrl(src) }}
      className={`${className} transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'} bg-brand-soft`}
    />
  )
}
