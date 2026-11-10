import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Fragment, lazy, Suspense } from 'react'
import { I18nProvider, useI18n } from './i18n'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ConfirmProvider } from './context/ConfirmContext'
import Layout from './components/Layout'
import { PageSkeleton, Spinner } from './components/ui'
import Login from './pages/auth/Login'
const QrMenu = lazy(() => import('./pages/public/QrMenu'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const Companies = lazy(() => import('./pages/admin/Companies'))
const Pricing = lazy(() => import('./pages/admin/Pricing'))
const ImageLibrary = lazy(() => import('./pages/admin/ImageLibrary'))
const AdminPayments = lazy(() => import('./pages/admin/Misc').then((m) => ({ default: m.AdminPayments })))
const AdminSettings = lazy(() => import('./pages/admin/Misc').then((m) => ({ default: m.AdminSettings })))
const AdminTickets = lazy(() => import('./pages/admin/Misc').then((m) => ({ default: m.AdminTickets })))
const Dashboard = lazy(() => import('./pages/app/Dashboard'))
const Tables = lazy(() => import('./pages/app/Tables'))
const NewOrder = lazy(() => import('./pages/app/NewOrder'))
const Orders = lazy(() => import('./pages/app/Orders'))
const Billing = lazy(() => import('./pages/app/Billing'))
const MenuManager = lazy(() => import('./pages/app/MenuManager'))
const Staff = lazy(() => import('./pages/app/Staff'))
const Expenses = lazy(() => import('./pages/app/Expenses'))
const Inventory = lazy(() => import('./pages/app/Inventory'))
const Reports = lazy(() => import('./pages/app/Reports'))
const Settings = lazy(() => import('./pages/app/Settings'))
const Subscription = lazy(() => import('./pages/app/Subscription'))
const Onboarding = lazy(() => import('./pages/app/Onboarding'))

// Where the app opens after launch / sign-in: the Orders tab (the Home tab is still one tap away)
function homeFor(a) {
  if (a.isSuperAdmin) return '/admin'
  if (a.can('orders.view')) return '/app/orders'
  if (a.can('dashboard.view')) return '/app'
  if (a.can('orders.create')) return '/app/tables'
  return '/app/orders'
}

function Guard({ children, superAdmin, perm }) {
  const a = useAuth()
  if (a.loading) return <Spinner />
  if (!a.user) return <Navigate to="/login" replace />
  if (superAdmin && !a.isSuperAdmin) return <Navigate to={homeFor(a)} replace />
  if (!superAdmin && a.isSuperAdmin) return <Navigate to="/admin" replace />
  // Bought-it-yourself companies see only the plan screen until they have paid
  if (!superAdmin && a.subscription_pending) return <Onboarding />
  if (perm && !a.can(perm)) return <Navigate to={homeFor(a)} replace />
  return children
}

const P = ({ perm, children }) => <Guard perm={perm}>{children}</Guard>

function Home() {
  const a = useAuth()
  if (a.loading) return <Spinner />
  return <Navigate to={a.user ? homeFor(a) : '/login'} replace />
}

/** Remount the screens when the language changes so every string (incl. non-hook ones) refreshes. */
function LangKeyed({ children }) {
  const { lang } = useI18n()
  return <Fragment key={lang}>{children}</Fragment>
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
        <AuthProvider>
          <LangKeyed>
          <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/menu/:slug/table/:token" element={<QrMenu />} />

            <Route path="/admin" element={<Guard superAdmin><Layout /></Guard>}>
              <Route index element={<AdminDashboard />} />
              <Route path="companies" element={<Companies />} />
              <Route path="pricing" element={<Pricing />} />
              <Route path="library" element={<ImageLibrary />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="tickets" element={<AdminTickets />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>

            <Route path="/app" element={<Guard><Layout /></Guard>}>
              <Route index element={<P perm="dashboard.view"><Dashboard /></P>} />
              <Route path="tables" element={<P perm="tables.view"><Tables /></P>} />
              <Route path="order/new" element={<P perm="orders.create"><NewOrder /></P>} />
              <Route path="orders" element={<P perm="orders.view"><Orders /></P>} />
              <Route path="billing" element={<P perm="billing.manage"><Billing /></P>} />
              <Route path="menu" element={<P perm="menu.manage"><MenuManager /></P>} />
              <Route path="inventory" element={<P perm="inventory.manage"><Inventory /></P>} />
              <Route path="expenses" element={<P perm="expenses.manage"><Expenses /></P>} />
              <Route path="reports" element={<P perm="reports.view"><Reports /></P>} />
              <Route path="staff" element={<P perm="users.manage"><Staff /></P>} />
              <Route path="subscription" element={<P perm="subscription.manage"><Subscription /></P>} />
              <Route path="settings" element={<P perm="settings.manage"><Settings /></P>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </LangKeyed>
        </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  )
}
