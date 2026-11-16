import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errMsg } from './api'
import { counterStore } from './counter'

/** GET helper with loading/error/reload and optional polling (used by kitchen / tables boards). */
export function useApi(url, { params, poll, skip } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState('')
  const key = JSON.stringify([url, params, counterStore.get()]) // a different counter = a different answer
  const alive = useRef(true)

  const load = useCallback(
    async (quiet) => {
      if (skip) return
      if (!quiet) setLoading(true)
      try {
        const r = await api.get(url, { params })
        if (alive.current) {
          setData(r.data)
          setError('')
        }
      } catch (e) {
        if (alive.current) setError(errMsg(e))
      } finally {
        if (alive.current) setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, skip],
  )

  useEffect(() => {
    alive.current = true
    load()
    // Polling only while the screen is actually being looked at (a hidden tab / locked phone does not hit the server);
    // coming back refreshes at once.
    const t = poll ? setInterval(() => { if (!document.hidden) load(true) }, poll) : null
    const onVisible = () => { if (poll && !document.hidden) load(true) }
    if (poll) document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      if (t) clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, poll])

  return { data, loading, error, reload: () => load(true), setData }
}
