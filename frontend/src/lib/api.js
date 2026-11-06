import axios from 'axios'
import { tr } from '../i18n'

const TOKEN_KEY = 'hms.token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { Accept: 'application/json' } })

api.interceptors.request.use((config) => {
  const t = tokenStore.get()
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn)

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && tokenStore.get()) {
      tokenStore.clear()
      onUnauthorized()
    }
    return Promise.reject(err)
  },
)

/** Human-readable message from a Laravel error response. */
export function errMsg(err) {
  const d = err?.response?.data
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
