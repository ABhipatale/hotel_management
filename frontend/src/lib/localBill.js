// A provisional bill made on the device while offline, in the same shape the receipt screen and the printers already use.
// The totals are worked out exactly as the server does (per line: price × qty, minus discount, plus GST, rounded to paise).
import { dateKey } from './format'

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** OFF-260116-0001 (bill) / OFF-O-260116-0001 (order): numbered on this device, per day, until the server gives the real number. */
export function offlineNumber(kind) {
  const day = dateKey().replace(/-/g, '').slice(2)
  const k = `hms.offseq.${kind}.${day}`
  let n = 1
  try { n = (Number(localStorage.getItem(k)) || 0) + 1; localStorage.setItem(k, String(n)) } catch { /* no storage: still unique enough with the time */ n = Date.now() % 10000 }

  return `OFF-${kind === 'O' ? 'O-' : ''}${day}-${String(n).padStart(4, '0')}`
}

export function buildLocalBill({ lines, items, company, printer, table, user, orderNo, billNo }) {
  const gstOn = company?.gst_enabled !== false
  let subtotal = 0
  let discount = 0
  let tax = 0
  const rows = lines.map((l, i) => {
    const gross = r2(l.price * l.quantity)
    const disc = r2((gross * l.discount) / 100)
    const t = gstOn ? r2(((gross - disc) * l.gst) / 100) : 0
    subtotal += gross; discount += disc; tax += t
    const food = (items || []).find((f) => f.id === l.food_item_id)
    const variant = l.variant_id ? food?.variants?.find((v) => v.id === l.variant_id) : null

    return {
      id: `off-${i}`, name: l.name, name_mr: food?.name_mr ? food.name_mr + (variant ? ` (${variant.name})` : '') : null,
      quantity: l.quantity, price: l.price, discount: disc, tax: t, total: r2(gross - disc + t),
    }
  })

  return {
    bill: {
      id: billNo, bill_no: billNo, created_at: new Date().toISOString(), status: 'unpaid',
      subtotal: r2(subtotal), discount: r2(discount), tax: r2(tax), grand_total: r2(subtotal - discount + tax), items: rows, payments: [],
    },
    company: {
      name: company?.name, logo_url: company?.logo_url, address: company?.address, phone: company?.phone, gst_number: company?.gst_number,
      gst_enabled: company?.gst_enabled, bill_header: company?.bill_header, bill_footer: company?.bill_footer, brand_color: company?.brand_color,
    },
    printer: printer || null,
    table: table?.number ?? null,
    order_no: orderNo,
    waiter: user?.name || null,
  }
}
