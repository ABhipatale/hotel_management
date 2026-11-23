export const money = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n || 0))

export const num = (n) => new Intl.NumberFormat('en-IN').format(Number(n || 0))

export const TZ = 'Asia/Kolkata'
export const dt = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const dateOnly = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export const ago = (d) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// Every date the app shows or decides ("today", greetings, receipts, reports) follows the Indian clock, on any device
/** Today's date on the Indian calendar, YYYY-MM-DD. */
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
/** The Indian calendar date (YYYY-MM-DD) of a moment. */
export const dateKey = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })
/** Hour of the day (0-23) in India right now. */
export const istHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
/** 12-hour clock time and short date in India: for bills, kitchen slips and printed receipts. */
export const timeIST = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true })
export const dateIST = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: TZ })

export const STATUS_STYLE = {
  available: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  occupied: 'bg-rose-50 border-rose-200 text-rose-700',
  reserved: 'bg-violet-50 border-violet-200 text-violet-700',
  preparing: 'bg-amber-50 border-amber-200 text-amber-700',
  ready: 'bg-sky-50 border-sky-200 text-sky-700',
  billing: 'bg-orange-50 border-orange-200 text-orange-700',
  paid: 'bg-slate-50 border-slate-200 text-slate-600',
}

/** A parcel counter is stored as "Parcel 1", "Parcel 2"... in the table list. */
export const isParcel = (n) => /^parcel\b/i.test(String(n ?? ''))
/** "Table 5" for a table, "Parcel 2" for a parcel counter (translated). `t` is the translate function. */
/** What a table card shows big: a parcel -> P3; a name that starts with a digit -> T3; anything else (G1, AC2) exactly as saved. */
export const tableLabel = (n) => {
  const s = String(n ?? '')
  return isParcel(s) ? `P${s.replace(/^parcel\s*/i, '')}` : /^\d/.test(s) ? `T${s}` : s
}
export const tableText = (t, n) => (isParcel(n) ? t('Parcel {n}', { n: String(n).replace(/^parcel\s*/i, '') }) : t('Table {n}', { n }))

/** Our line at the very end of every printed / shown bill. */
export const BILL_AD = 'ABnexa.in 9689030301'
