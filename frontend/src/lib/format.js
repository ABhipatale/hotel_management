export const money = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0))

export const num = (n) => new Intl.NumberFormat('en-IN').format(Number(n || 0))

export const dt = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const dateOnly = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export const ago = (d) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export const today = () => new Date().toISOString().slice(0, 10)

export const STATUS_STYLE = {
  available: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  occupied: 'bg-rose-50 border-rose-200 text-rose-700',
  reserved: 'bg-violet-50 border-violet-200 text-violet-700',
  preparing: 'bg-amber-50 border-amber-200 text-amber-700',
  ready: 'bg-sky-50 border-sky-200 text-sky-700',
  billing: 'bg-orange-50 border-orange-200 text-orange-700',
  paid: 'bg-slate-50 border-slate-200 text-slate-600',
}
