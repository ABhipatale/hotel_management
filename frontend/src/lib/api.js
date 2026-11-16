import axios from 'axios'
import { tr } from '../i18n'
import { counterStore } from './counter'

const TOKEN_KEY = 'hms.token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { Accept: 'application/json' } })

/** True when the request never got an answer (no internet, captive Wi-Fi, timeout) or the server / gateway is down. */
export const isNetworkError = (e) => (!e?.response && (e?.code === 'ERR_NETWORK' || e?.code === 'ECONNABORTED' || e?.message === 'Network Error' || e?.code === 'ETIMEDOUT'))
  || [502, 503, 504].includes(e?.response?.status)

// ── Offline copy ───────────────────────────────────────────────────────────────────────────────────────────────
// The few things the owner needs to take an order and print a bill without internet (the session, menu, tables, shop details, printer)
// are remembered on this device each time they load. With no internet the last copy is used, so the app still opens and the order screen works.
const OFFLINE_COPY = ['/auth/me', '/menu/items', '/menu/categories', '/tables', '/company', '/printer']
const CACHE_PREFIX = 'hms.cache.'
const owner = () => (tokenStore.get() || '').split('|')[0] // one signed-in person's copy is never used for another
const copyKey = (c) => `${CACHE_PREFIX}${owner()}.${c.url}|${JSON.stringify(c.params || {})}|${counterStore.get() || ''}`
const remember = (c, data) => { try { localStorage.setItem(copyKey(c), JSON.stringify(data)) } catch { /* storage full / private mode: just no offline copy */ } }
const recall = (c) => { try { const v = localStorage.getItem(copyKey(c)); return v ? JSON.parse(v) : null } catch { return null } }
export const clearOfflineCopy = () => { try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k)) } catch { /* nothing to clear */ } }
/** Loads the offline copy now (while online), so it exists even if the screens were never opened. */
export const warmOfflineCopy = () => {
  try {
    const last = Number(localStorage.getItem(`${CACHE_PREFIX}warm`)) || 0
    if (Date.now() - last < 15 * 60 * 1000) return Promise.resolve() // refreshed recently: no need to ask the server again
    localStorage.setItem(`${CACHE_PREFIX}warm`, String(Date.now()))
  } catch { /* no storage: just load it */ }

  return Promise.allSettled(OFFLINE_COPY.filter((u) => u !== '/auth/me').map((u) => api.get(u)))
}

api.interceptors.request.use((config) => {
  const t = tokenStore.get()
  if (t) config.headers.Authorization = `Bearer ${t}`
  const c = counterStore.get()
  if (c) config.headers['X-Counter-Id'] = c
  return config
})

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn)

api.interceptors.response.use(
  (r) => {
    if (r.config?.method === 'get' && OFFLINE_COPY.includes(r.config.url)) remember(r.config, r.data)
    return r
  },
  (err) => {
    if (err.response?.status === 401 && tokenStore.get()) {
      tokenStore.clear()
      onUnauthorized()
    }
    // No internet: answer these few screens from the last copy instead of failing
    const c = err.config
    if (isNetworkError(err) && c?.method === 'get' && OFFLINE_COPY.includes(c.url)) {
      const copy = recall(c)
      if (copy) return Promise.resolve({ data: copy, status: 200, statusText: 'offline copy', headers: {}, config: c, offline: true })
    }
    return Promise.reject(err)
  },
)

/** Human-readable message from a Laravel error response. */
export function errMsg(err) {
  const d = err?.response?.data
  if (err?.response?.status === 429 && /too many attempts/i.test(d?.message || '')) return tr('Too many requests. Please wait a moment and try again.')
  if (d?.errors) return tr(Object.values(d.errors).flat()[0])
  return tr(d?.message || err?.message || 'Something went wrong')
}

/** Axios helper for multipart forms (logo / food images). Skips empty values. */
export function toFormData(obj) {
  const fd = new FormData()
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    if (typeof v === 'boolean') fd.append(k, v ? '1' : '0')
    else if (Array.isArray(v)) v.forEach((row, i) => Object.entries(row).forEach(([rk, rv]) => fd.append(`${k}[${i}][${rk}]`, rv)))
    else fd.append(k, v)
  })
  return fd
}
