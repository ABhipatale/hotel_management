import { useState } from 'react'
import { Download } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../../lib/useApi'
import { money, today } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { Button, Card, Chips, Input, PageHeader, Select, Spinner, Table } from '../../components/ui'

const REPORTS = [
  ['sales', 'Sales'], ['tables', 'Table-wise'], ['waiters', 'Waiter-wise'], ['items', 'Item-wise'], ['payments', 'Payment-wise'],
  ['expenses', 'Expenses', 'expenses'], ['inventory', 'Inventory', 'inventory'], ['pnl', 'Profit & Loss', 'pnl'],
]

const COLS = {
  tables: [['table_no', 'Table'], ['orders', 'Orders'], ['sales', 'Sales', 'm']],
  waiters: [['waiter', 'Waiter'], ['orders', 'Orders'], ['sales', 'Sales', 'm']],
  items: [['name', 'Item'], ['qty', 'Qty sold'], ['revenue', 'Revenue', 'm']],
  payments: [['method', 'Method'], ['count', 'Payments'], ['total', 'Total', 'm']],
  expenses: [['category', 'Category'], ['entries', 'Entries'], ['total', 'Total', 'm']],
  inventory: [['name', 'Item'], ['quantity', 'Quantity'], ['unit', 'Unit'], ['min_quantity', 'Alert level']],
  sales: [['period', 'Period'], ['bills', 'Bills'], ['sales', 'Sales', 'm'], ['tax', 'GST', 'm'], ['discount', 'Discount', 'm']],
}

function toCsv(rows, cols) {
  const head = cols.map((c) => c[1]).join(',')
  const body = rows.map((r) => cols.map((c) => JSON.stringify(r[c[0]] ?? '')).join(',')).join('\n')
  return `${head}\n${body}`
}

export default function Reports() {
  const { hasFeature } = useAuth()
  const [type, setType] = useState('sales')
  const [group, setGroup] = useState('day')
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })
  const { data, loading, error } = useApi(`/reports/${type}`, { params: { ...range, group } })

  const available = REPORTS.filter(([, , f]) => !f || hasFeature(f))
  const rows = type === 'sales' ? data?.rows : data
  const cols = COLS[type]

  const csv = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([toCsv(rows, cols)], { type: 'text/csv' }))
    a.download = `${type}-report-${range.from}_${range.to}.csv`
    a.click()
  }

  return (
    <>
      <PageHeader title="Reports" actions={cols && rows?.length ? <Button variant="secondary" onClick={csv}><Download className="h-4 w-4" /> CSV</Button> : null} />
      <Chips items={available.map(([k, l]) => [k, l])} value={type} onChange={setType} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex">
        <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        {type === 'sales' && <Select value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Daily</option><option value="month">Monthly</option><option value="year">Yearly</option></Select>}
      </div>

      {error ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p> : loading ? <Spinner /> : type === 'pnl' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[['Gross sales', data.sales], ['GST collected', data.tax_collected], ['Net sales', data.net_sales], ['Expenses', data.expenses], ['Profit', data.profit]].map(([l, v]) => (
            <Card key={l}><div className="text-xs text-muted">{l}</div><div className={`text-xl font-semibold ${l === 'Profit' && v < 0 ? 'text-rose-600' : ''}`}>{money(v)}</div></Card>
          ))}
        </div>
      ) : (
        <>
          {type === 'sales' && rows?.length > 0 && (
            <Card className="mb-4"><div className="h-64"><ResponsiveContainer><BarChart data={rows}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" fontSize={11} /><YAxis fontSize={11} /><Tooltip formatter={(v) => money(v)} /><Bar dataKey="sales" fill="var(--brand)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
          )}
          <Table rows={rows} empty="No data for this period" rowKey="__i" columns={cols.map(([k, h, f]) => ({ header: h, render: (r) => (f === 'm' ? money(r[k]) : r[k]) }))} />
        </>
      )}
    </>
  )
}
