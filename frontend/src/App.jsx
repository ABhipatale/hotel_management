import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ConfirmProvider } from './context/ConfirmContext'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import QrMenu from './pages/public/QrMenu'
import AdminDashboard from './pages/admin/AdminDashboard'
import Companies from './pages/admin/Companies'
import Plans from './pages/admin/Plans'
import { AdminPayments, AdminSettings, AdminTickets } from './pages/admin/Misc'
import Dashboard from './pages/app/Dashboard'
import Tables from './pages/app/Tables'
import NewOrder from './pages/app/NewOrder'
import Orders from './pages/app/Orders'
import Billing from './pages/app/Billing'
import MenuManager from './pages/app/MenuManager'
import Staff from './pages/app/Staff'
import Expenses from './pages/app/Expenses'
import Inventory from './pages/app/Inventory'
import Reports from './pages/app/Reports'
import Settings from './pages/app/Settings'
import Subscription from './pages/app/Subscription'

function homeFor(a) {
  if (a.isSuperAdmin) return '/admin'
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
  if (perm && !a.can(perm)) return <Navigate to={homeFor(a)} replace />
  return children
}

const P = ({ perm, children }) => <Guard perm={perm}>{children}</Guard>

function Home() {
  const a = useAuth()
  if (a.loading) return <Spinner />
  return <Navigate to={a.user ? homeFor(a) : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/menu/:slug/table/:token" element={<QrMenu />} />

            <Route path="/admin" element={<Guard superAdmin><Layout /></Guard>}>
              <Route index element={<AdminDashboard />} />
              <Route path="companies" element={<Companies />} />
              <Route path="plans" element={<Plans />} />
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
        </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
