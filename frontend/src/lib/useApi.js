import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errMsg } from './api'

/** GET helper with loading/error/reload and optional polling (used by kitchen / tables boards). */
export function useApi(url, { params, poll, skip } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState('')
  const key = JSON.stringify([url, params])
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
    const t = poll ? setInterval(() => load(true), poll) : null
    return () => {
      alive.current = false
      if (t) clearInterval(t)
    }
  }, [load, poll])

  return { data, loading, error, reload: () => load(true), setData }
}
