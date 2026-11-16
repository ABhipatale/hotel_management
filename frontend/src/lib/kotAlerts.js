import { useEffect, useRef } from 'react'
import { api } from './api'
import { ring } from './orderAlerts'

/**
 * "Your order is ready" alerts for waiters / captains / owner. Polls a tiny endpoint while the app is open; the first poll only records
 * a watermark, so opening the app never rings for old tickets. `onReady(kot)` is called once per ticket.
 */
export function useKotReadyAlerts(enabled, onReady, scope = '') {
  const since = useRef(null)
  const seen = useRef(new Set())
  const cb = useRef(onReady)
  cb.current = onReady

  useEffect(() => {
    if (!enabled) return undefined
    since.current = null
    seen.current = new Set()
    let stop = false
    let timer
    const tick = async () => {
      try {
        const { data } = await api.get('/kots/ready', { params: since.current ? { since: since.current } : {} })
        since.current = data.since
        const fresh = data.kots.filter((k) => !seen.current.has(k.id))
        fresh.forEach((k) => seen.current.add(k.id))
        if (!stop && fresh.length) { ring(); fresh.forEach((k) => cb.current?.(k)) }
      } catch { /* offline / signed out: next time */ }
      if (!stop) timer = setTimeout(tick, document.hidden ? 30000 : 6000)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [enabled, scope])
}
