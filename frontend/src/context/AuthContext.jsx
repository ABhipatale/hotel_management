import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, branchStore, setUnauthorizedHandler, tokenStore } from '../lib/api'
import { applyBrand } from '../lib/branding'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)


const applyBranding = (company) => applyBrand(company)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(!!tokenStore.get())
  const [branches, setBranches] = useState([])

  const clear = useCallback(() => {
    tokenStore.clear()
    branchStore.set(null)
    setSession(null)
    setBranches([])
    applyBranding(null)
  }, [])

  // Branch-wise UI (switcher, branch filters, branch columns) only appears once a company has 2+ branches.
  const reloadBranches = useCallback(
    () => api.get('/branches').then((r) => setBranches(r.data)).catch(() => {}),
    [],
  )
  const companyId = session?.company?.id
  useEffect(() => {
    if (companyId) reloadBranches()
  }, [companyId, reloadBranches])

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
      branches,
      multiBranch: branches.length > 1,
      reloadBranches,
      can: (p) => perms.includes('*') || perms.includes(p),
      hasFeature: (f) => !!session?.plan?.features?.includes(f),
      login,
      register,
      logout,
      refresh,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading, refresh, branches, reloadBranches])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
