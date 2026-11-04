import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Armchair, BarChart3, Building2, CreditCard, GitBranch, Grid2x2, Layers, LayoutDashboard, LifeBuoy, LogOut, Package, Plus, Receipt,
  Settings, ShoppingBag, Store, Users, UtensilsCrossed, Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { branchStore } from '../lib/api'
import { Modal } from './ui'

const ADMIN_NAV = [
  { to: '/admin', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/admin/companies', icon: Building2, label: 'Companies' },
  { to: '/admin/plans', icon: Layers, label: 'Plans' },
  { to: '/admin/payments', icon: Wallet, label: 'Payments' },
  { to: '/admin/tickets', icon: LifeBuoy, label: 'Support' },
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
]

const TENANT_NAV = [
  { to: '/app', icon: LayoutDashboard, label: 'Home', perm: 'dashboard.view', end: true },
  { to: '/app/tables', icon: Armchair, label: 'Tables', perm: 'tables.view' },
  { to: '/app/orders', icon: ShoppingBag, label: 'Orders', perm: 'orders.view' },
  { to: '/app/billing', icon: Receipt, label: 'Bills', perm: 'billing.manage' },
  { to: '/app/menu', icon: UtensilsCrossed, label: 'Menu', perm: 'menu.manage' },
  { to: '/app/inventory', icon: Package, label: 'Inventory', perm: 'inventory.manage' },
  { to: '/app/expenses', icon: Wallet, label: 'Expenses', perm: 'expenses.manage' },
  { to: '/app/reports', icon: BarChart3, label: 'Reports', perm: 'reports.view' },
  { to: '/app/staff', icon: Users, label: 'Staff', perm: 'users.manage' },
  { to: '/app/branches', icon: GitBranch, label: 'Branches', perm: 'branches.manage' },
  { to: '/app/subscription', icon: CreditCard, label: 'Plan', perm: 'subscription.manage' },
  { to: '/app/settings', icon: Settings, label: 'Settings', perm: 'settings.manage' },
]

function Logo({ company, isSuperAdmin, size = 'h-10 w-10' }) {
  if (isSuperAdmin) return <div className={`grid ${size} shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-md`}><Store className="h-5 w-5" /></div>
  return company?.logo_url
    ? <img src={company.logo_url} alt="" className={`${size} shrink-0 rounded-2xl object-cover shadow-sm`} />
    : <div className={`grid ${size} shrink-0 place-items-center rounded-2xl bg-brand-gradient text-lg font-extrabold text-white shadow-md`}>{company?.name?.[0]}</div>
}

export default function Layout() {
  const { user, company, can, isSuperAdmin, logout, subscription_expired, subscription, branches, multiBranch } = useAuth()
  const [more, setMore] = useState(false)
  const [branch, setBranch] = useState(branchStore.get() || '')
  const nav = useNavigate()
  const loc = useLocation()

  useEffect(() => { setMore(false) }, [loc.pathname])

  // Branch switcher only for owners/unlocked staff of a company that really has several branches.
  const canSwitch = !isSuperAdmin && !user?.branch_id && multiBranch
  const changeBranch = (v) => { setBranch(v); branchStore.set(v); window.location.reload() }
  const doLogout = async () => { await logout(); nav('/login') }

  const items = isSuperAdmin ? ADMIN_NAV : TENANT_NAV.filter((n) => can(n.perm))
  const canNew = !isSuperAdmin && can('orders.create')
  const daysLeft = subscription ? Math.ceil((new Date(subscription.ends_at) - Date.now()) / 86400000) : null

  // Mobile: up to 4 primary tabs (+ centre "new order" button) and everything else under "More".
  const primary = isSuperAdmin ? items.slice(0, 4) : items.filter((i) => ['/app', '/app/tables', '/app/orders', '/app/billing'].includes(i.to)).slice(0, 4)
  const rest = items.filter((i) => !primary.includes(i))
  const left = canNew ? primary.slice(0, 2) : primary.slice(0, 2)
  const right = primary.slice(2)

  const tab = (i) => (
    <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${isActive ? 'text-brand' : 'text-slate-400'}`}>
      {({ isActive }) => (
        <>
          <span className={`grid h-8 w-12 place-items-center rounded-full transition ${isActive ? 'bg-brand-soft' : ''}`}><i.icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 2} /></span>
          {i.label}
        </>
      )}
    </NavLink>
  )

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-white p-4 lg:flex">
        <div className="flex items-center gap-3"><Logo company={company} isSuperAdmin={isSuperAdmin} /><div className="min-w-0 leading-tight"><div className="truncate font-bold">{isSuperAdmin ? 'Hotel SaaS' : company?.name}</div><div className="text-xs text-muted">{isSuperAdmin ? 'Platform admin' : company?.uid}</div></div></div>
        <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition ${isActive ? 'bg-brand-gradient text-white shadow-md shadow-brand/25' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Icon className="h-[18px] w-[18px]" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand">{user?.name?.[0]}</div>
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-sm font-semibold">{user?.name}</div><div className="text-xs capitalize text-muted">{user?.role?.replace('_', ' ')}</div></div>
          <button onClick={doLogout} className="rounded-xl p-2 text-muted hover:bg-slate-100" aria-label="Log out"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile app bar */}
        <header className="safe-top sticky top-0 z-30 bg-brand-gradient text-white lg:bg-white lg:bg-none lg:text-ink lg:shadow-none lg:ring-1 lg:ring-line">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-8">
            <div className="lg:hidden"><Logo company={company} isSuperAdmin={isSuperAdmin} size="h-10 w-10" /></div>
            <div className="min-w-0 flex-1 leading-tight lg:hidden">
              <div className="truncate text-base font-extrabold">{isSuperAdmin ? 'Hotel SaaS' : company?.name}</div>
              <div className="truncate text-xs text-white/75">Hi, {user?.name?.split(' ')[0]} · <span className="capitalize">{user?.role?.replace('_', ' ')}</span></div>
            </div>
            <div className="hidden flex-1 lg:block" />
            {canSwitch && (
              <select value={branch} onChange={(e) => changeBranch(e.target.value)} className="max-w-[9rem] rounded-xl border-0 bg-white/20 px-3 py-2 text-sm font-medium text-white backdrop-blur lg:max-w-none lg:border lg:border-line lg:bg-white lg:text-ink [&>option]:text-ink">
                <option value="">Default branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
        </header>

        {!isSuperAdmin && subscription_expired && (
          <div className="bg-rose-600 px-4 py-2 text-center text-sm text-white">Subscription expired — read-only. <NavLink to="/app/subscription" className="font-bold underline">Renew</NavLink></div>
        )}
        {!isSuperAdmin && !subscription_expired && subscription?.status === 'trial' && daysLeft !== null && (
          <div className="bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800">Free trial · {Math.max(daysLeft, 0)} day(s) left{can('subscription.manage') && <> · <NavLink to="/app/subscription" className="font-bold underline">Choose plan</NavLink></>}</div>
        )}

        <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-5 pb-32 lg:px-8 lg:pb-8"><Outlet /></main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-end px-2">
          {left.map(tab)}
          {canNew && (
            <div className="flex flex-1 justify-center">
              <button onClick={() => nav('/app/order/new')} aria-label="New order" className="-mt-6 grid h-16 w-16 place-items-center rounded-full bg-brand-gradient text-white shadow-float ring-4 ring-white transition active:scale-95">
                <Plus className="h-8 w-8" strokeWidth={2.6} />
              </button>
            </div>
          )}
          {right.map(tab)}
          <button onClick={() => setMore(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-slate-400">
            <span className="grid h-8 w-12 place-items-center rounded-full"><Grid2x2 className="h-[22px] w-[22px]" /></span>
            More
          </button>
        </div>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="Menu">
        <div className="grid grid-cols-3 gap-3">
          {rest.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 px-2 py-4 text-center text-xs font-semibold text-slate-700 active:bg-brand-soft">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-brand shadow-sm"><Icon className="h-5 w-5" /></span>{label}
            </NavLink>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand">{user?.name?.[0]}</div>
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate font-semibold">{user?.name}</div><div className="truncate text-xs text-muted">{user?.email}</div></div>
          <button onClick={doLogout} className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-rose-600 shadow-sm"><LogOut className="h-4 w-4" /> Log out</button>
        </div>
      </Modal>
    </div>
  )
}
