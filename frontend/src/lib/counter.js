/**
 * Counter selection for multi-counter companies.
 * The OWNER can look at every counter ("all") or pick one; the choice is sent to the server as the X-Counter-Id header.
 * The server only honours it for the owner (counter logins are pinned to their own counter server-side).
 */
const KEY = 'hms.counter'
let current = ''
try { current = localStorage.getItem(KEY) || '' } catch { /* private mode */ }

export const counterStore = {
  get: () => current,
  set: (v) => {
    current = v ? String(v) : ''
    try { current ? localStorage.setItem(KEY, current) : localStorage.removeItem(KEY) } catch { /* private mode */ }
  },
}

/** One fixed colour per counter (by its position), validated for colour-blind separation. Names are always shown too. */
export const COUNTER_COLORS = ['#0E8F84', '#E04A2A', '#2F6FA8', '#B7791F', '#7A4EA3', '#3F8F3F']
export const counterColor = (index) => COUNTER_COLORS[Math.max(0, index) % COUNTER_COLORS.length]
