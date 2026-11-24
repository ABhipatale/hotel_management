import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { ring } from './orderAlerts'
import { printKot } from './kotSlip'

/**
 * "KOT not printed" (company switch kot_unprinted_alert, set by the platform admin): when a waiter's phone does not print the
 * kitchen slip, the owner, counter manager and captains see it (banner + ring + a red mark on the order card) and print it from
 * their own device. Waiters and chefs are never alerted.
 */

/** Logins that are told about unprinted slips and get the Print KOT button. */
export const KOT_PRINT_ROLES = ['owner', 'counter', 'captain']

/** The switch is on AND printed slips are part of KOT for this company (print on, or no kitchen screen). */
export const unprintedAlertOn = (company) =>
  !!company?.kot_enabled && !!company?.kot_unprinted_alert && (!!company?.kot_print || company?.kot_screen === false)

/** This login, on this company, gets the alerts and the Print KOT buttons. */
export const canPrintForOthers = (company, user) => unprintedAlertOn(company) && KOT_PRINT_ROLES.includes(user?.role)

/** Seconds a slip may stay unprinted before anyone is alerted: the sender's own printer (auto / "Yes, print") gets the first chance. */
export const GRACE_SECONDS = 15

/** Sent on this device after a slip was printed (or found already printed), so the banner and the order cards update at once. */
export const KOT_PRINTED_EVENT = 'hms:kotprinted'
const announce = () => { try { window.dispatchEvent(new Event(KOT_PRINTED_EVENT)) } catch { /* ignore */ } }

/**
 * Prints one unprinted kitchen slip on this device and marks it printed. The ticket is fetched fresh first, so a slip that a
 * colleague printed a moment ago (or the kitchen already started) is not printed twice: then it answers 'done' without printing.
 * Throws the printer's error (no printer chosen, Bluetooth off...) for the caller to show.
 */
export async function printUnprintedKot(id, company, lang) {
  const { data } = await api.get('/kots/unprinted', { params: { id } })
  const kot = (data?.kots || []).find((k) => k.id === id)
  if (!kot) { announce(); return 'done' }
  await printKot(kot, company, lang)
  await api.post(`/kots/${id}/printed`).catch(() => {}) // printed is printed: a failed note only means the mark stays red a little longer
  announce()
  return 'printed'
}

/**
 * Live list of slips nobody printed (polled while the app is open, slower in the background). `alerts` = the ones to show:
 * older than the grace period and not closed on this device. Rings once for each slip that becomes an alert after the app was
 * opened (slips already waiting when the app opens are shown without a sound), unless `quiet(kot)` says it was just announced.
 */
export function useUnprintedKots(enabled, scope = '', quiet = null) {
  const [got, setGot] = useState({ scope: null, list: [] }) // the answer, with the counter it was for
  const [closed, setClosed] = useState(() => new Set())
  const rung = useRef(null) // ids already announced (null until the first answer)
  const quietRef = useRef(quiet)
  useEffect(() => { quietRef.current = quiet }, [quiet])
  const timer = useRef(null)
  const tickRef = useRef(null)
  const busy = useRef(false) // one request at a time, even when refresh() is called while a poll is under way

  useEffect(() => {
    if (!enabled) return undefined
    rung.current = null // another counter: start again without ringing for what is already waiting there
    const run = { stop: false } // set when this effect is cleaned up (counter switched, signed out, page closed)
    const tick = async () => {
      if (busy.current) return
      busy.current = true
      clearTimeout(timer.current)
      try {
        const { data } = await api.get('/kots/unprinted')
        if (run.stop) return
        const list = data?.kots || []
        const due = list.filter((k) => k.age >= GRACE_SECONDS)
        if (rung.current == null) rung.current = new Set(due.map((k) => k.id))
        else {
          const fresh = due.filter((k) => !rung.current.has(k.id))
          fresh.forEach((k) => rung.current.add(k.id))
          if (fresh.some((k) => !quietRef.current?.(k))) ring()
        }
        setGot({ scope, list })
      } catch { /* offline or signed out: try again next time */ }
      busy.current = false
      if (!run.stop) timer.current = setTimeout(tick, document.hidden ? 30000 : 5000)
    }
    tickRef.current = tick
    tick()
    return () => { run.stop = true; busy.current = false; tickRef.current = null; clearTimeout(timer.current) }
  }, [enabled, scope])

  const close = useCallback((id) => setClosed((s) => new Set(s).add(id)), [])
  /** Ask again now (after printing), instead of waiting for the next poll. */
  const refresh = useCallback(() => { tickRef.current?.() }, [])
  useEffect(() => {
    window.addEventListener(KOT_PRINTED_EVENT, refresh)
    return () => window.removeEventListener(KOT_PRINTED_EVENT, refresh)
  }, [refresh])
  const kots = enabled && got.scope === scope ? got.list : [] // nothing from another counter or while switched off
  const alerts = kots.filter((k) => k.age >= GRACE_SECONDS && !closed.has(k.id))
  return { kots, alerts, close, refresh }
}
