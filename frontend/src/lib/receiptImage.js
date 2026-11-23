// Receipt as a picture for thermal printers. Plain ESC/POS text cannot print Marathi (the printer has no Devanagari font),
// so the bill is drawn on a canvas (the phone's own fonts shape the Devanagari correctly) and sent as ESC/POS raster bands.
// Used when the app is in Marathi, or whenever the bill holds non-English text (e.g. a Marathi business name).

import { BILL_AD, dateIST, timeIST } from './format'
import { billStyle } from './billLang'
import { qrMatrix, upiLink } from './upiQr'

const ESC = 0x1b
const GS = 0x1d

export const LABELS = {
  en: { bill: 'Bill', date: 'Date', table: 'Table', staff: 'Staff', item: 'ITEM', qty: 'QTY', rate: 'RATE', amt: 'AMT', items: 'Items', totalQty: 'Qty', subtotal: 'Subtotal', discount: 'Discount', gst: 'GST', total: 'TOTAL', paid: 'Paid', cash: 'cash', upi: 'upi', scan: 'Scan to pay', thanks: 'Thank you! Visit again.', phone: 'Ph', gstin: 'GSTIN' },
  mr: { bill: 'बिल क्र.', date: 'दिनांक', table: 'टेबल', staff: 'वेटर', item: 'वस्तू', qty: 'नग', rate: 'दर', amt: 'रक्कम', items: 'एकूण वस्तू', totalQty: 'एकूण नग', subtotal: 'उप-एकूण', discount: 'सूट', gst: 'जीएसटी', total: 'एकूण', paid: 'भरले', cash: 'रोख', upi: 'UPI', scan: 'पैसे भरण्यासाठी स्कॅन करा', thanks: 'धन्यवाद! पुन्हा भेट द्या.', phone: 'फोन', gstin: 'GSTIN' },
}
/** "Table: 5" for a table, "Parcel 2" for a parcel counter (Marathi: पार्सल 2). */
export const tableLine = (L, lang, table) => (/^parcel\b/i.test(String(table)) ? `${lang === 'mr' ? 'पार्सल' : 'Parcel'} ${String(table).replace(/^parcel\s*/i, '')}` : `${L.table}: ${table}`)
/** The customer's name (takeaway / parcel, asked at checkout). */
export const customerLine = (lang, name) => `${lang === 'mr' ? 'ग्राहक' : 'Customer'}: ${name}`
export const receiptLabels = (lang) => LABELS[lang === 'mr' ? 'mr' : 'en']

/** Dish name on the bill: Marathi name in Marathi mode (when the dish has one), otherwise as billed. */
export const receiptName = (item, lang) => (lang === 'mr' && item.name_mr ? item.name_mr : item.name)

/** The shop's saved footer is the English default text: show the Marathi thank-you instead when printing in Marathi. */
export const receiptFooter = (company, lang) => {
  const f = (company.bill_footer || '').trim()
  return !f || /^thank you!? visit again\.?$/i.test(f) ? receiptLabels(lang).thanks : f
}

/** True when the bill contains characters a plain ESC/POS text printer would print as "?". */
export function needsImage(data, lang) {
  if (lang === 'mr') return true
  if (billStyle.get() !== 'text') return true // English is drawn as a picture too: the same tight, aligned layout as Marathi (this device can choose fast plain text instead)
  const { bill, company, table, waiter } = data
  const all = [company.name, company.address, company.bill_header, company.bill_footer, company.phone, table, waiter, ...bill.items.map((i) => i.name)].join('')
  return /[^\x20-\x7E\n]/.test(all) // eslint-disable-line no-control-regex
}

const FONT = '"Noto Sans Devanagari","Mukta","Nirmala UI","Kohinoor Devanagari","Mangal","Noto Sans","Segoe UI",Arial,sans-serif'
const money = (n) => Number(n).toFixed(2)

async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load('500 24px "Noto Sans Devanagari"', 'अआइ'),
      document.fonts.load('400 24px "Noto Sans Devanagari"', 'अआइ'),
      document.fonts.load('700 24px "Noto Sans Devanagari"', 'अआइ'),
      document.fonts.load('400 24px "Noto Sans"', 'Ag'),
      document.fonts.load('700 24px "Noto Sans"', 'Ag'),
    ])
  } catch { /* system fonts are used */ }
}

/** @returns {Promise<Uint8Array>} ESC/POS bytes: raster bands + feed + cut */
export async function buildReceiptImage({ bill, company, table, order_no, waiter, printer, customer_name: data_customer }, lang = 'en') {
  await loadFonts()
  const L = receiptLabels(lang)
  const wide = printer?.paper_width !== '58mm'
  const W = wide ? 576 : 384 // printable dots (8 dots per mm)
  const pad = 4
  const base = wide ? 30 : 27 // a little bigger so the bill is easy to read
  const lh = Math.round(base * 1.4)
  const gstOn = company.gst_enabled !== false

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = 900 + bill.items.length * lh * 3 + (upiLink(company, bill) ? 400 : 0)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, canvas.height)
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  let y = 22 // small blank top margin so the printer never clips the first line

  const setFont = (size) => { ctx.font = `500 ${size}px ${FONT}` } // one even, medium weight everywhere: bold letters smudge together on a thermal printer
  const wrap = (text, maxW) => {
    const out = []
    String(text).split('\n').forEach((para) => {
      let cur = ''
      para.split(/\s+/).filter(Boolean).forEach((word) => {
        const trial = cur ? `${cur} ${word}` : word
        if (ctx.measureText(trial).width <= maxW) { cur = trial; return }
        if (cur) out.push(cur)
        cur = ''
        let chunk = ''
        for (const ch of word) { // a single word wider than the line: break it
          if (ctx.measureText(chunk + ch).width > maxW && chunk) { out.push(chunk); chunk = '' }
          chunk += ch
        }
        cur = chunk
      })
      if (cur) out.push(cur)
    })
    return out
  }
  const centered = (text, size = base, bold = false) => {
    setFont(size, bold)
    wrap(text, W - pad * 2).forEach((ln) => {
      y += Math.round(size * 1.25)
      ctx.textAlign = 'center'
      ctx.fillText(ln, W / 2, y)
      y += Math.round(size * 0.2)
    })
  }
  const pair = (left, right, size = base, bold = false) => {
    setFont(size, bold)
    y += Math.round(size * 1.3)
    ctx.textAlign = 'left'
    ctx.fillText(left, pad, y)
    ctx.textAlign = 'right'
    ctx.fillText(right, W - pad, y)
    y += Math.round(size * 0.15)
  }
  const rule = (kind = 'dash') => {
    y += 6
    ctx.save()
    ctx.lineWidth = 2
    if (kind === 'dash') ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(W - pad, y)
    ctx.stroke()
    if (kind === 'double') { ctx.beginPath(); ctx.moveTo(pad, y + 5); ctx.lineTo(W - pad, y + 5); ctx.stroke(); y += 5 }
    ctx.restore()
    y += 6
  }

  // ── header ──
  centered(company.name || '', wide ? 40 : 34, true)
  if (company.bill_header) centered(company.bill_header, base - 1)
  if (company.address) centered(company.address, base - 1)
  if (company.phone) centered(`${L.phone}: ${company.phone}`, base - 1)
  if (gstOn && company.gst_number) centered(`${L.gstin}: ${company.gst_number}`, base - 1)
  rule('double')

  // ── bill details ──
  const d = new Date(bill.created_at)
  const when = `${dateIST(d)} ${timeIST(d)}`
  pair(`${L.bill}: ${bill.bill_no}`, '', base - 1)
  pair(`${L.date}: ${when}`, '', base - 1)
  if (table) pair(tableLine(L, lang, table), '', base - 1) // the waiter's name is not printed on the bill
  if (data_customer) pair(customerLine(lang, data_customer), '', base - 1)
  void order_no // the order number is not printed on the bill
  rule()

  // ── items table ──
  const qtyW = wide ? 64 : 56
  const rateW = wide ? 120 : 0
  const amtW = wide ? 132 : 112
  const nameW = W - pad * 2 - qtyW - rateW - amtW - 8
  const xQty = W - pad - amtW - rateW
  const xRate = W - pad - amtW
  const xAmt = W - pad
  setFont(base - 1, true)
  y += Math.round((base - 1) * 1.3)
  ctx.textAlign = 'left'; ctx.fillText(L.item, pad, y)
  ctx.textAlign = 'right'; ctx.fillText(L.qty, xQty, y)
  if (wide) ctx.fillText(L.rate, xRate, y)
  ctx.fillText(L.amt, xAmt, y)
  y += 4
  rule()

  let qty = 0
  bill.items.forEach((i) => {
    qty += Number(i.quantity)
    const amt = money(i.price * i.quantity - i.discount + Number(i.tax))
    setFont(base, false)
    const rows = wrap(receiptName(i, lang), nameW)
    y += Math.round(base * 1.3)
    ctx.textAlign = 'left'; ctx.fillText(rows[0] || '', pad, y)
    ctx.textAlign = 'right'; ctx.fillText(String(i.quantity), xQty, y)
    if (wide) ctx.fillText(money(i.price), xRate, y)
    ctx.fillText(amt, xAmt, y)
    rows.slice(1).forEach((r) => { y += Math.round(base * 1.25); ctx.textAlign = 'left'; ctx.fillText(r, pad + 8, y) })
    y += 5
  })
  rule()
  pair(`${L.items}: ${bill.items.length}`, `${L.totalQty}: ${qty}`, base - 1)
  rule()

  // ── totals ──
  pair(L.subtotal, money(bill.subtotal))
  if (Number(bill.discount)) pair(L.discount, `-${money(bill.discount)}`)
  if (gstOn && Number(bill.tax)) pair(L.gst, money(bill.tax))
  rule('double')
  pair(L.total, money(bill.grand_total), wide ? 34 : 30, true)
  rule('double')
  if (bill.payments?.length) {
    bill.payments.forEach((p) => pair(`${L.paid} (${L[p.method] || p.method})`, money(p.amount)))
  }

  // ── UPI payment QR (exact amount; only on a bill that is not paid yet) ──
  const pay = upiLink(company, bill)
  if (pay) {
    y += 8
    centered(`${L.scan} ₹${money(bill.grand_total)}`, base, true)
    const m = qrMatrix(pay)
    const px = Math.max(2, Math.floor(Math.min(wide ? 210 : 190, W - 16) / (m.length + 8)))
    const side = (m.length + 8) * px
    const x0 = Math.floor((W - side) / 2)
    y += 6
    ctx.fillStyle = '#000'
    m.forEach((row, r) => row.forEach((dark, c) => { if (dark) ctx.fillRect(x0 + (c + 4) * px, y + (r + 4) * px, px, px) }))
    y += side
  }

  // ── footer ──
  y += 10
  centered(receiptFooter(company, lang), base, true)
  y += 4
  centered(BILL_AD, base - 8) // small one-line advertisement
  if (wide) y += 90 // 80 mm printers: blank bottom margin, the cutter sits below the print head and would cut through the last line (58 mm was already fine)

  // ── canvas -> 1-bit raster bands ──
  const H = Math.min(canvas.height, y)
  const img = ctx.getImageData(0, 0, W, H).data
  const rowBytes = W / 8
  const bytes = [ESC, 0x40] // init
  const BAND = 128
  for (let top = 0; top < H; top += BAND) {
    const h = Math.min(BAND, H - top)
    bytes.push(GS, 0x76, 0x30, 0, rowBytes & 255, rowBytes >> 8, h & 255, h >> 8)
    for (let r = 0; r < h; r++) {
      for (let bx = 0; bx < rowBytes; bx++) {
        let b = 0
        for (let bit = 0; bit < 8; bit++) {
          const p = ((top + r) * W + bx * 8 + bit) * 4
          const lum = (img[p] * 299 + img[p + 1] * 587 + img[p + 2] * 114) / 1000
          if (lum < 150) b |= 0x80 >> bit
        }
        bytes.push(b)
      }
    }
  }
  bytes.push(ESC, 0x64, wide ? 4 : 3) // feed 4 lines (80 mm) / 3 lines (58 mm, as before)
  bytes.push(GS, 0x56, 0x42, 0x00) // partial cut (ignored by printers without a cutter)
  return new Uint8Array(bytes)
}
