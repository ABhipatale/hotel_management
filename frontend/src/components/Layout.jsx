import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Armchair, BarChart3, Bell, Building2, Clock, CreditCard, Download, Images, LayoutDashboard, LifeBuoy, LogOut, Package, Plus, Receipt,
  Settings, ShoppingBag, Store, Tag, Users, UtensilsCrossed, Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../context/ConfirmContext'
import { useToast } from '../context/ToastContext'
import { useT } from '../i18n'
import LangSwitch from './LangSwitch'
import { usePwaInstall } from '../lib/pwa'
import { useApi } from '../lib/useApi'
import { Avatar, Modal } from './ui'

const ADMIN_NAV = [
  { to: '/admin', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/admin/companies', icon: Building2, label: 'Companies' },
  { to: '/admin/pricing', icon: Tag, label: 'Pricing' },
  { to: '/admin/library', icon: Images, label: 'Image library' },
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
  { to: '/app/subscription', icon: CreditCard, label: 'Subscription', perm: 'subscription.manage' },
  { to: '/app/settings', icon: Settings, label: 'Settings', perm: 'settings.manage' },
]

/** Tenant logo (or initial) on a light tile so any logo reads clearly on the teal header / sidebar. */
function Logo({ company, isSuperAdmin, size = 'h-11 w-11' }) {
  const tile = `${size} shrink-0 rounded-2xl`
  if (isSuperAdmin) return <div className={`grid ${tile} place-items-center bg-ivory text-brand`}><Store className="h-5 w-5" strokeWidth={2.3} /></div>
  return company?.logo_url
    ? <img src={company.logo_url} alt="" decoding="async" className={`${tile} bg-white object-contain p-1`} />
    : <div className={`grid ${tile} place-items-center bg-ivory text-lg font-extrabold text-brand`}>{company?.name?.[0]}</div>
}

export default function Layout() {
  const { user, company, can, isSuperAdmin, logout, subscription_expired, subscription } = useAuth()
  const t = useT()
  const [more, setMore] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()

  useEffect(() => { setMore(false) }, [loc.pathname])

  // Notification bell: orders waiting to be accepted (e.g. QR orders from customers). Light 30s poll.
  const showBell = !isSuperAdmin && can('orders.view')
  const { data: pending } = useApi('/orders', { params: { status: 'pending' }, poll: 30000, skip: !showBell })
  const pendingCount = pending?.length || 0

  const doLogout = async () => { await logout(); nav('/login') }

  // Install as an app (PWA): native prompt where the browser supports it, short instructions elsewhere (iPhone Safari…)
  const pwa = usePwaInstall()
  const ask = useConfirm()
  const toast = useToast()
  const doInstall = async () => {
    const r = await pwa.install()
    if (r === 'accepted') toast.success('Installing… find the app on your home screen')
    if (r !== 'manual') return
    await ask({
      title: 'Install this app',
      message: pwa.ios
        ? 'In Safari tap the Share button, then “Add to Home Screen”.'
        : 'Open your browser menu (⋮) and choose “Install app” or “Add to Home screen”.',
      confirmText: 'Got it',
      tone: 'primary',
    })
  }

  // Subscription warning: shown from 3 days before the end date until it expires
  const msLeft = subscription?.ends_at ? new Date(subscription.ends_at) - Date.now() : Infinity
  const daysLeft = Math.ceil(msLeft / 86400000)
  const expiresSoon = msLeft > 0 && daysLeft <= 3
  const endsText = daysLeft <= 1
    ? (new Date(subscription?.ends_at).toDateString() === new Date().toDateString() ? t('Your subscription ends today.') : t('Your subscription ends tomorrow.'))
    : t('Your subscription ends in {n} days.', { n: daysLeft })
  const roleText = (r) => t(r?.replace('_', ' ') || '')

  const items = isSuperAdmin ? ADMIN_NAV : TENANT_NAV.filter((n) => can(n.perm))
  const canNew = !isSuperAdmin && can('orders.create')

  // Mobile: up to 4 primary tabs around the centre "new order" button. Everything else lives in the
  // account menu that opens from the avatar in the top-right corner.
  const primary = isSuperAdmin ? items.slice(0, 4) : items.filter((i) => ['/app', '/app/tables', '/app/orders', '/app/billing'].includes(i.to)).slice(0, 4)
  const rest = items.filter((i) => !primary.includes(i))
  const half = Math.floor(primary.length / 2)
  const left = primary.slice(0, half)
  const right = primary.slice(half)

  const tab = (i) => (
    <NavLink key={i.to} to={i.to} end={i.end} className="group relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold">
      {({ isActive }) => (
        <>
          {/* Coral active indicator */}
          <span className={`absolute left-1/2 top-0 h-[3px] -translate-x-1/2 rounded-full bg-accent transition-all duration-300 ${isActive ? 'w-7 opacity-100' : 'w-0 opacity-0'}`} />
          <i.icon className={`h-[22px] w-[22px] transition group-active:scale-90 ${isActive ? 'text-brand' : 'text-slate-400'}`} strokeWidth={isActive ? 2.5 : 2} />
          <span className={isActive ? 'text-brand' : 'text-slate-400'}>{t(i.label)}</span>
        </>
      )}
    </NavLink>
  )

  const BellBtn = (
    <button onClick={() => nav('/app/orders')} aria-label={pendingCount ? t(pendingCount > 1 ? 'Notifications, {n} new orders' : 'Notifications, {n} new order', { n: pendingCount }) : t('Notifications')} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition active:scale-90 lg:bg-ivory lg:text-brand lg:ring-0">
      <Bell className="h-5 w-5" />
      {pendingCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-extrabold text-white ring-2 ring-brand lg:ring-white">
          <span className="animate-ping-soft absolute inset-0 rounded-full bg-accent/60" />
          <span className="relative">{pendingCount > 9 ? '9+' : pendingCount}</span>
        </span>
      )}
    </button>
  )

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar — Deep Teal */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-brand p-4 text-white lg:flex">
        <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
          <Logo company={company} isSuperAdmin={isSuperAdmin} />
          <div className="min-w-0 leading-tight"><div className="truncate font-extrabold">{isSuperAdmin ? 'Hotel SaaS' : company?.name}</div><div className="text-xs text-white/60">{isSuperAdmin ? t('Platform admin') : company?.uid}</div></div>
        </div>
        <nav className="mt-5 flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `relative flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-bold transition ${isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent" />}
                  <Icon className="h-[18px] w-[18px]" /> {t(label)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <LangSwitch tone="dark" className="mt-4 w-full justify-between" />
        <div className="mt-4 flex items-center gap-3 border-t border-white/15 pt-4">
          <Avatar name={user?.name} className="!bg-ivory !text-brand !ring-0" />
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-sm font-bold">{user?.name}</div><div className="text-xs capitalize text-white/60">{roleText(user?.role)}</div></div>
          <button onClick={doLogout} className="grid h-10 w-10 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white" aria-label={t('Log out')}><LogOut className="h-[18px] w-[18px]" /></button>
        </div>
        {!pwa.installed && (
          <button onClick={doInstall} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/15 px-3 text-sm font-bold text-white transition hover:bg-white/25">
            <Download className="h-[18px] w-[18px]" /> {t('Install app')}
          </button>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* App bar: Deep Teal on phones, clean white on desktop */}
        <header className="pt-[env(safe-area-inset-top)] sticky top-0 z-30 bg-brand text-white lg:bg-white! lg:text-ink! lg:ring-1 lg:ring-line">
          <div className="flex items-center gap-3 px-4 py-3 lg:px-8">
            <div className="lg:hidden"><Logo company={company} isSuperAdmin={isSuperAdmin} /></div>
            <div className="min-w-0 flex-1 leading-tight lg:hidden">
              <div className="truncate text-[17px] font-extrabold tracking-tight">{isSuperAdmin ? 'Hotel SaaS' : company?.name}</div>
              <div className="truncate text-xs font-medium text-white/70">{t('Hi, {name}', { name: user?.name?.split(' ')[0] })} · <span className="capitalize">{roleText(user?.role)}</span></div>
            </div>
            <div className="hidden flex-1 lg:block" />
            {showBell && BellBtn}
            <button onClick={() => setMore(true)} aria-label={t('Account menu')} className="lg:hidden"><Avatar name={user?.name} className="!bg-ivory !text-brand !ring-0" /></button>
          </div>
        </header>

        {!isSuperAdmin && subscription_expired && (
          <div className="bg-rose-600 px-4 py-2.5 text-center text-sm font-medium text-white">{t('Subscription expired — read-only.')} {can('subscription.manage') ? <NavLink to="/app/subscription" className="font-extrabold underline">{t('Renew')}</NavLink> : <span className="font-bold">{t('Please ask the owner to renew.')}</span>}</div>
        )}
        {/* Heads-up banner during the last 3 days before the subscription ends */}
        {!isSuperAdmin && !subscription_expired && expiresSoon && (
          <div role="status" className="flex items-center justify-center gap-2 bg-accent px-4 py-2 text-center text-[13px] font-bold text-white">
            <Clock className="h-4 w-4 shrink-0" />
            <span>{endsText}</span>
            {can('subscription.manage') ? <NavLink to="/app/subscription" className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-extrabold underline-offset-2 hover:underline">{t('Renew now')}</NavLink> : <span className="font-medium opacity-90">{t('Ask the owner to renew.')}</span>}
          </div>
        )}

        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-5 pb-36 sm:px-6 lg:px-8 lg:pb-8">
          <div key={loc.pathname} className="animate-page"><Outlet /></div>
        </main>
      </div>

      {/* Bottom navigation (phones & small tablets): white bar, teal active icon, coral indicator + FAB */}
      <nav aria-label={t('Primary')} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:hidden">
        <div className="pointer-events-auto mx-auto flex max-w-md items-end rounded-[1.25rem] bg-white px-2 shadow-float ring-1 ring-line">
          {/* Two equal-width groups keep the New Order button exactly centred, whatever the tab count */}
          <div className="flex min-w-0 flex-1">{left.map(tab)}</div>
          {canNew && (
            <div className="flex w-20 shrink-0 justify-center">
              <button onClick={() => nav('/app/order/new')} aria-label={t('New order')} className="-mt-7 grid h-16 w-16 place-items-center rounded-full bg-accent text-white shadow-[0_12px_24px_-8px_rgb(255_104_69/.8)] ring-[5px] ring-white transition active:scale-90">
                <Plus className="h-8 w-8" strokeWidth={2.6} />
              </button>
            </div>
          )}
          <div className="flex min-w-0 flex-1">{right.map(tab)}</div>
        </div>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="Menu">
        <div className="grid grid-cols-3 gap-3">
          {rest.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className="flex min-h-[6.5rem] flex-col items-center justify-center gap-2.5 rounded-[1.25rem] bg-canvas px-2 py-4 text-center text-xs font-bold text-slate-700 ring-1 ring-line transition active:scale-95">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand shadow-card"><Icon className="h-5 w-5" strokeWidth={2.2} /></span>{t(label)}
            </NavLink>
          ))}
        </div>
        <div className="mt-5 flex justify-center"><LangSwitch /></div>
        <div className="mt-4 flex items-center gap-3 rounded-[1.25rem] bg-canvas p-3.5 ring-1 ring-line">
          <Avatar name={user?.name} size="lg" className="!bg-brand !ring-0" />
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate font-bold">{user?.name}</div><div className="truncate text-xs text-muted">{user?.email}</div></div>
          <button onClick={doLogout} className="flex min-h-11 items-center gap-1.5 rounded-2xl bg-white px-3.5 text-sm font-bold text-rose-600 shadow-card transition active:scale-95"><LogOut className="h-4 w-4" /> {t('Log out')}</button>
        </div>
        {!pwa.installed && (
          <button onClick={doInstall} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-sm font-extrabold text-white shadow-card transition active:scale-[0.98]">
            <Download className="h-5 w-5" strokeWidth={2.4} /> {t('Install app')}
          </button>
        )}
      </Modal>
    </div>
  )
}
