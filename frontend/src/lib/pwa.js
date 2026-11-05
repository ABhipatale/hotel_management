import { useEffect, useState } from 'react'

// The browser fires `beforeinstallprompt` once, often before the user logs in: capture it at module load.
let deferred = null
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify() })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)

const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

/**
 * PWA install helper.
 * installed: already running as an installed app (hide the button)
 * install(): returns 'accepted' | 'dismissed' | 'manual' ('manual' = show instructions: iOS / browsers without the prompt)
 */
export function usePwaInstall() {
  const [, tick] = useState(0)
  useEffect(() => {
    const fn = () => tick((n) => n + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])

  const install = async () => {
    if (!deferred) return 'manual'
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    notify()
    return outcome
  }

  return { installed: isStandalone(), ios: isIos(), canPrompt: !!deferred, install }
}
