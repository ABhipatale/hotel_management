import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '../lib/api'
import { applyBrand } from '../lib/branding'
import { useI18n } from '../i18n'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)


const applyBranding = (company) => applyBrand(company)

export function AuthProvider({ children }) {
  const { setDefault } = useI18n()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(!!tokenStore.get())

  const clear = useCallback(() => {
    tokenStore.clear()
    setSession(null)
    applyBranding(null)
  }, [])


  const load = useCallback((data) => {
    setSession(data)
    applyBranding(data.company)
    if (data.company?.default_language) setDefault(data.company.default_language)
  }, [setDefault])

  useEffect(() => {
    setUnauthorizedHandler(clear)
    if (!tokenStore.get()) return
    api
      .get('/auth/me')
      .then((r) => load(r.data))
      .catch(() => clear())
      .finally(() => setLoading(false))
  }, [clear, load])

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    tokenStore.set(data.token)
    load(data)
    return data
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* token may already be invalid */
    }
    clear()
  }

  const refresh = useCallback(() => api.get('/auth/me').then((r) => load(r.data)), [load])

  // Re-read the account (GST switch, subscription…) when the user comes back to the app after a while
  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) return undefined
    let last = Date.now()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 30000) {
        last = Date.now()
        refresh().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId, refresh])

  const value = useMemo(() => {
    const perms = session?.permissions || []
    return {
      ...session,
      loading,
      isSuperAdmin: session?.user?.role === 'super_admin',
      can: (p) => perms.includes('*') || perms.includes(p),
      hasFeature: (f) => !!session?.plan?.features?.includes(f),
      login,
      logout,
      refresh,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading, refresh])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
