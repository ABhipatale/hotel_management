import { dt, money } from '../lib/format'
import { useT } from '../i18n'
import { Card, Table } from './ui'

/** "Discounts & voids": what the owner should look at every day, with who did it and who approved it. */
export default function ExceptionsReport({ data }) {
  const t = useT()
  if (!data?.totals) return null // right after switching tabs the screen still holds the previous report's data for a moment
  const who = (a) => ({ owner: t('Owner'), pin: t('Owner PIN'), 'within limit': t('Within limit') }[a] || '—')
  const idx = (rows) => (rows || []).map((r, i) => ({ ...r, __i: i }))
  const base = [{ header: t('When'), render: (r) => dt(r.at) }, { header: t('By'), key: 'by' }]
  const sections = [
    ['Cancelled bills', 'voids', [...base, { header: t('Bill'), key: 'bill_no' }, { header: t('Amount'), render: (r) => money(r.total) }, { header: t('Reason'), key: 'reason' }, { header: t('Approved by'), render: (r) => who(r.approved) }]],
    ['Extra discounts', 'discounts', [...base, { header: t('Bill'), key: 'bill_no' }, { header: t('Discount'), render: (r) => money(r.extra_discount) }, { header: t('Approved by'), render: (r) => who(r.approved) }]],
    ['Orders cancelled after the kitchen started', 'cancellations', [...base, { header: t('Order'), key: 'order_no' }, { header: t('Was'), render: (r) => t(String(r.status_before).replace(/^./, (c) => c.toUpperCase())) }, { header: t('Amount'), render: (r) => money(r.amount) }, { header: t('Approved by'), render: (r) => who(r.approved) }]],
    ['Dishes removed after the kitchen started', 'removed', [...base, { header: t('Order'), key: 'order_no' }, { header: t('Dishes'), render: (r) => (r.items || []).map((i) => `${i.qty}× ${i.name}`).join(', ') }, { header: t('Amount'), render: (r) => money(r.amount) }]],
  ]
  const totals = [['Cancelled bills', data.totals.voids], ['Extra discounts', data.totals.discounts], ['Orders cancelled after the kitchen started', data.totals.cancellations], ['Dishes removed after the kitchen started', data.totals.removed]]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {totals.map(([l, v]) => <Card key={l}><div className="text-xs text-muted">{t(l)}</div><div className={`text-xl font-semibold ${v > 0 ? 'text-accent-dark' : ''}`}>{money(v)}</div></Card>)}
      </div>
      {sections.map(([title, key, columns]) => (
        <section key={key}>
          <h3 className="mb-2 text-sm font-extrabold">{t(title)} <span className="font-semibold text-muted">· {data[key]?.length || 0}</span></h3>
          <Table rows={idx(data[key])} rowKey="__i" empty={t('Nothing in this period: all clear')} columns={columns} />
        </section>
      ))}
    </div>
  )
}
