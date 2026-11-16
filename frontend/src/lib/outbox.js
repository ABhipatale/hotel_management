// Orders taken while the device had no internet. They are kept on the device and sent when the connection is back.
// Every order carries a unique reference (client_ref): if the connection drops after the server saved it, the retry gives the same
// order back instead of making a second one.
import { useSyncExternalStore } from 'react'
import { api, errMsg, isNetworkError } from './api'
import { tr } from '../i18n'

const KEY = 'hms.outbox'
const DONE = 'hms.outbox.done'
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
let snapshot = { pending: read(KEY), done: read(DONE) }
const listeners = new Set()
const emit = () => { snapshot = { pending: read(KEY), done: read(DONE) }; listeners.forEach((f) => f()) }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage full: the order stays in memory only until reload; rare */ } emit() }
window.addEventListener('storage', emit) // another tab of the app changed it

export const newRef = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 24) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`)

export const outbox = {
  add: (entry) => write(KEY, [...read(KEY), entry]),
  remove: (id) => write(KEY, read(KEY).filter((e) => e.id !== id)),
  update: (id, patch) => write(KEY, read(KEY).map((e) => (e.id === id ? { ...e, ...patch } : e))),
  /** A failed order the owner decided to try again. */
  retry: (id) => outbox.update(id, { status: 'pending', error: null }),
}

export const useOutbox = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => snapshot)

/** navigator.onLine, live. (A connected phone with no real internet still falls back through isNetworkError on the request itself.) */
export const useOnline = () => useSyncExternalStore((cb) => {
  window.addEventListener('online', cb); window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}, () => navigator.onLine)

let syncing = false
/** Sends this person's waiting orders, oldest first. Stops at the first "no internet". Returns what happened. */
export async function syncOutbox(userId) {
  if (syncing || !navigator.onLine) return null
  syncing = true
  const result = { sent: 0, failed: 0, pairs: [] }
  try {
    for (const e of read(KEY).filter((x) => x.userId === userId && x.status !== 'failed')) {
      try {
        const { data } = await api.post('/orders', { ...e.payload, client_ref: e.id, client_time: e.createdAt }, { timeout: 20000 })
        outbox.remove(e.id)
        const local = e.local?.bill_no || e.local?.order_no
        const server = data.bill?.bill_no || data.order_no
        write(DONE, [{ id: e.id, local, server, total: e.total, at: new Date().toISOString() }, ...read(DONE)].slice(0, 30))
        result.sent += 1
        if (local && server) result.pairs.push(`${local} → ${server}`)
      } catch (err) {
        if (isNetworkError(err)) break // still no internet: keep everything, try later
        const why = errMsg(err)
        // the server refused it (e.g. a dish was deleted): kept, with the reason, for the owner to decide
        outbox.update(e.id, { status: 'failed', error: /food_item|variant/i.test(why) ? tr('A dish in this order is no longer on the menu.') : why })
        result.failed += 1
      }
    }
  } finally {
    syncing = false
  }

  return result
}
