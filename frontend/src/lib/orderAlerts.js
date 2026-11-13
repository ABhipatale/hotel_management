import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

// ── sound: browsers only allow audio after the user has touched the page once, so it is unlocked on the first tap ──
let ctx
const unlock = () => {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
  } catch { /* no audio available */ }
}
if (typeof window !== 'undefined') ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, unlock, { passive: true }))

const soundOn = () => { try { return localStorage.getItem('hms.alertsound') !== '0' } catch { return true } }
export const setAlertSound = (on) => { try { localStorage.setItem('hms.alertsound', on ? '1' : '0') } catch { /* private mode */ } }
export const alertSoundEnabled = soundOn

/** Three quick rising beeps + vibration. */
export function ring() {
  try { navigator.vibrate?.([200, 100, 200]) } catch { /* ignore */ }
  if (!ctx || !soundOn()) return
  try {
    const t0 = ctx.currentTime
    ;[880, 1175, 1480].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      const at = t0 + i * 0.2
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.5, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(at)
      o.stop(at + 0.18)
    })
  } catch { /* ignore */ }
}

/**
 * Live "new order" alerts for the owner / billing counter: orders placed by OTHER people (captains, waiters, QR customers).
 * Polls a tiny feed every few seconds while the app is open; the first poll only records the newest id, so opening the app
 * never rings for old orders.
 */
export function useOrderAlerts(enabled, scope = '') {
  const [banners, setBanners] = useState([])
  const [unseen, setUnseen] = useState(0)
  const after = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    after.current = null // another counter has its own order ids: start from its newest order
    setBanners([])
    let stop = false
    let timer
    const tick = async () => {
      try {
        const { data } = await api.get('/orders/feed', { params: after.current == null ? {} : { after: after.current } })
        after.current = data.latest_id
        if (!stop && data.orders.length) {
          setUnseen((n) => n + data.orders.length)
          setBanners((b) => [...b, ...data.orders].slice(-4))
          ring()
        }
      } catch { /* offline or signed out: try again next time */ }
      if (!stop) timer = setTimeout(tick, document.hidden ? 15000 : 5000)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [enabled, scope])

  const dismiss = useCallback((id) => setBanners((b) => b.filter((x) => x.id !== id)), [])
  const clearUnseen = useCallback(() => setUnseen(0), [])
  return { banners, unseen, dismiss, clearUnseen }
}
