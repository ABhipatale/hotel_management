import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, branchStore, setUnauthorizedHandler, tokenStore } from '../lib/api'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

const DEFAULT_BRAND = '#4f46e5'

function applyBranding(company) {
  const color = company?.brand_color || DEFAULT_BRAND
  document.documentElement.style.setProperty('--brand', color)
  document.title = company?.name ? `${company.name} · Hotel SaaS` : 'Hotel SaaS'
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', color)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(!!tokenStore.get())

  const clear = useCallback(() => {
    tokenStore.clear()
    branchStore.set(null)
    setSession(null)
    applyBranding(null)
  }, [])

  const load = useCallback((data) => {
    setSession(data)
    applyBranding(data.company)
  }, [])

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
    branchStore.set(null)
    load(data)
    return data
  }

  const register = async (formData) => {
    const { data } = await api.post('/auth/register', formData)
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

  const value = useMemo(() => {
    const perms = session?.permissions || []
    return {
      ...session,
      loading,
      isSuperAdmin: session?.user?.role === 'super_admin',
      can: (p) => perms.includes('*') || perms.includes(p),
      hasFeature: (f) => !!session?.plan?.features?.includes(f),
      login,
      register,
      logout,
      refresh,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading, refresh])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
