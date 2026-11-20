// Kitchen slip (KOT) for thermal printers. Drawn on a canvas and sent as a picture so Marathi dish names print correctly
// (a plain ESC/POS printer has no Devanagari font), with big bold dishes that are easy to read in a hot kitchen.
import { printBluetooth, printUsb, savedPrinter, textTune } from './escpos'
import { dateIST, timeIST } from './format'

const ESC = 0x1b
const GS = 0x1d
const FONT = '"Noto Sans Devanagari","Mukta","Nirmala UI","Kohinoor Devanagari","Mangal","Noto Sans","Segoe UI",Arial,sans-serif'

const get = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const put = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
export const kotPrefs = {
  width: () => (get('hms.kot.width', '80mm') === '58mm' ? '58mm' : '80mm'),
  setWidth: (v) => put('hms.kot.width', v),
  /** 'picture' (default) or 'text': the fast plain-text slip (English only; Marathi is always a picture) */
  style: () => (get('hms.kot.style', 'picture') === 'text' ? 'text' : 'picture'),
  setStyle: (v) => put('hms.kot.style', v === 'text' ? 'text' : 'picture'),
  /** print a slip automatically: on the kitchen screen when a ticket arrives, on the order screen when an order is placed */
  auto: (where) => get(`hms.kot.auto.${where}`, '0') === '1',
  setAuto: (where, on) => put(`hms.kot.auto.${where}`, on ? '1' : '0'),
  /** what happens to the printed slip when an order is placed on THIS device: 'off' | 'ask' (Yes/No popup) | 'auto' */
  orderMode: (companyDefault) => { const m = get('hms.kot.mode.order', null); return m === 'ask' || m === 'auto' || m === 'off' ? m : (get('hms.kot.auto.order', '0') === '1' ? 'auto' : (['auto', 'ask', 'off'].includes(companyDefault) ? companyDefault : 'off')) }, // this device's own choice, else the platform admin's default for the company, else off
  setOrderMode: (m) => { put('hms.kot.mode.order', m); put('hms.kot.auto.order', m === 'auto' ? '1' : '0') },
}

/** Which saved printer this device would print to (null = none chosen yet). */
export function kotConnection() {
  if (savedPrinter('bluetooth') && navigator.bluetooth) return 'bluetooth'
  if (savedPrinter('usb') && navigator.usb) return 'usb'
  return null
}

async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load('400 24px "Noto Sans Devanagari"', 'अआइ'), document.fonts.load('700 24px "Noto Sans Devanagari"', 'अआइ'),
      document.fonts.load('400 24px "Noto Sans"', 'Ag'), document.fonts.load('700 24px "Noto Sans"', 'Ag'),
    ])
  } catch { /* system fonts are used */ }
}

/**
 * Draws one ticket. 80 mm (576 px) is the full design; 58 mm (384 px) is the same layout scaled down.
 * @returns {Promise<{ canvas: HTMLCanvasElement, W: number, H: number }>} the finished picture (H = used height)
 */
export async function drawKotCanvas(kot, company, { width = '80mm', lang = 'en' } = {}) {
  await loadFonts()
  const mr = lang === 'mr'
  const L = mr
    ? { kot: 'केओटी', cancel: 'थांबवा – रद्द', table: 'टेबल', takeaway: 'पार्सल', delivery: 'डिलिव्हरी', order: 'ऑर्डर', by: 'वेटर', note: 'सूचना', items: 'एकूण डिश', printed: 'प्रिंट' }
    : { kot: 'KOT', cancel: 'STOP - CANCELLED', table: 'TABLE', takeaway: 'TAKEAWAY', delivery: 'DELIVERY', order: 'Order', by: 'By', note: 'NOTE', items: 'Total items', printed: 'Printed' }
  const wide = width !== '58mm'
  const W = wide ? 576 : 384
  const k = wide ? 1 : 0.68 // everything below is drawn for 80 mm and scaled for 58 mm
  const pad = Math.round(10 * k)
  const lines = kot.items || []
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = 930 + lines.length * 260
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, canvas.height)
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  let y = Math.round(30 * k) // blank top margin: many printers clip the first rows of a picture
  const font = (size, bold = true) => { ctx.font = `${bold ? 700 : 400} ${Math.round(size * k)}px ${FONT}` }
  const wrap = (text, maxW) => {
    const out = []
    let cur = ''
    String(text).split(/\s+/).filter(Boolean).forEach((word) => {
      const trial = cur ? `${cur} ${word}` : word
      if (ctx.measureText(trial).width <= maxW) { cur = trial; return }
      if (cur) out.push(cur)
      cur = word
    })
    if (cur) out.push(cur)
    return out
  }
  const center = (text, size, bold = true) => { font(size, bold); y += Math.round(size * k * 1.2); ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y); y += Math.round(4 * k) }
  const pair = (l, r, size = 23, bold = false) => { font(size, bold); y += Math.round(size * k * 1.35); ctx.textAlign = 'left'; ctx.fillText(l, pad, y); ctx.textAlign = 'right'; ctx.fillText(r, W - pad, y) }
  const rule = (kind = 'solid') => {
    y += Math.round(10 * k)
    ctx.save()
    if (kind === 'dash') ctx.setLineDash([Math.round(9 * k), Math.round(6 * k)])
    if (kind === 'dots') ctx.setLineDash([2, Math.round(7 * k)])
    ctx.lineWidth = kind === 'thick' ? Math.max(4, Math.round(6 * k)) : Math.max(2, Math.round(3 * k))
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke()
    ctx.restore()
    y += Math.round(10 * k)
  }
  const bar = (text, size, h) => { // black text in an outlined box (no solid black: a solid block makes a thermal printer very slow)
    const bh = Math.round(h * k)
    ctx.lineWidth = Math.max(3, Math.round(4 * k)); ctx.strokeRect(pad + 2, y + 2, W - pad * 2 - 4, bh - 4)
    ctx.fillStyle = '#000'; font(size); ctx.textAlign = 'center'
    ctx.fillText(text, W / 2, y + bh / 2 + Math.round(size * k * 0.35))
    y += bh
  }

  const isCancel = kot.type === 'cancel'

  // 1. shop name
  if (company?.name) {
    font(26)
    wrap(company.name, W - pad * 2).slice(0, 2).forEach((ln) => { y += Math.round(32 * k); ctx.textAlign = 'center'; ctx.fillText(ln, W / 2, y) })
    y += Math.round(6 * k)
  }
  rule('thick')

  // 2. the big ticket number (a cancelled ticket gets the STOP bar instead, so only one black bar is ever on the slip)
  if (isCancel) {
    bar(L.cancel, 34, 66)
    y += Math.round(6 * k)
    center(`${L.kot} #${kot.number}`, 64)
  } else {
    bar(`${L.kot} #${kot.number}`, 70, 104)
  }

  // 3. where it goes: table (boxed) / takeaway / delivery
  const t = kot.order?.table
  const parcel = t && /^parcel\b/i.test(String(t.number))
  const where = t ? (parcel ? `${mr ? 'पार्सल' : 'PARCEL'} ${String(t.number).replace(/^parcel\s*/i, '')}` : `${L.table} ${t.number}`) : (kot.order?.type === 'delivery' ? L.delivery : L.takeaway)
  y += Math.round(12 * k)
  font(54)
  const bw = Math.min(W - pad * 2, ctx.measureText(where).width + Math.round(60 * k))
  const bh = Math.round(76 * k)
  ctx.lineWidth = Math.max(3, Math.round(5 * k))
  ctx.strokeRect(Math.round((W - bw) / 2), y, bw, bh)
  ctx.textAlign = 'center'; ctx.fillText(where, W / 2, y + bh / 2 + Math.round(54 * k * 0.35))
  y += bh
  if (t?.section) center(t.section, 26, false)

  // 4. order details
  y += Math.round(6 * k)
  const when = new Date(kot.created_at)
  pair(`${L.order}: ${kot.order?.order_no || ''}`, timeIST(when), 23, true)
  pair(kot.sender?.name ? `${L.by}: ${kot.sender.name}` : '', dateIST(when))
  rule('thick')

  // 5. dishes: quantity in a frame, name big, size / variant on its own line
  const qb = Math.round(80 * k)
  const gap = Math.round(16 * k)
  const nameSize = 38
  lines.forEach((i, n) => {
    if (n > 0) y += Math.round(12 * k) // plain gap, no dotted line: dotted rows make a thermal printer slow down
    font(nameSize)
    const nameLines = wrap(i.name, W - pad * 2 - qb - gap)
    const nameH = Math.round(nameSize * k * 1.18)
    const varSize = 28
    const blockH = nameLines.length * nameH + (i.variant ? Math.round(varSize * k * 1.3) : 0)
    const rowH = Math.max(qb, blockH)
    // quantity box
    ctx.lineWidth = Math.max(3, Math.round(5 * k))
    ctx.strokeRect(pad + 1, y + 2, qb, qb - 4)
    font(46); ctx.textAlign = 'center'; ctx.fillText(String(i.quantity), pad + 1 + qb / 2, y + 2 + (qb - 4) / 2 + Math.round(46 * k * 0.35))
    // name (+ variant)
    font(nameSize); ctx.textAlign = 'left'
    const top = y + Math.round(nameSize * k * 0.95) + Math.max(0, Math.round((rowH - blockH) / 2))
    nameLines.forEach((ln, idx) => ctx.fillText(ln, pad + qb + gap, top + idx * nameH))
    if (i.variant) { font(varSize, false); ctx.fillText(`(${i.variant})`, pad + qb + gap, top + nameLines.length * nameH - Math.round(4 * k)) }
    y += rowH + Math.round(12 * k)
  })
  rule('thick')

  // 6. kitchen note, framed
  if (kot.note) {
    font(28)
    const noteLines = wrap(kot.note, W - pad * 2 - Math.round(24 * k))
    const lh = Math.round(36 * k)
    const h = (noteLines.length + 1) * lh + Math.round(16 * k)
    y += Math.round(4 * k)
    ctx.lineWidth = Math.max(3, Math.round(5 * k)); ctx.strokeRect(pad + 1, y, W - pad * 2 - 2, h)
    font(22); ctx.textAlign = 'left'; ctx.fillText(L.note, pad + Math.round(12 * k), y + lh * 0.9)
    font(28)
    noteLines.forEach((ln, idx) => ctx.fillText(ln, pad + Math.round(12 * k), y + (idx + 1.9) * lh))
    y += h + Math.round(8 * k)
    y += Math.round(8 * k) // test: no dotted line
  }

  // 7. footer
  const total = lines.reduce((n, i) => n + Number(i.quantity), 0)
  pair(`${L.items}: ${total}`, `${L.printed} ${timeIST(new Date())}`, 22, false)
  y += Math.round(16 * k)

  return { canvas, W, H: Math.min(canvas.height, y) }
}

/** Fast plain-text slip: the printer's own letters (no picture to send), big bold dishes. English only. */
export function buildKotText(kot, company, { width = '80mm' } = {}) {
  const cols = width === '58mm' ? 32 : 48
  const out = [ESC, 0x40, ESC, 0x4d, 0] // Font A: 32 / 48 letters per line, so everything lines up
  const enc = new TextEncoder()
  const push = (...b) => out.push(...b)
  const txt = (s) => push(...enc.encode(String(s).replace(/[^\x20-\x7E\n]/g, '?')))
  const line = (s = '') => txt(`${s}\n`)
  const tight = textTune.spacing()
  const spacing = (n) => push(ESC, 0x33, n)
  const size = (n) => push(GS, 0x21, n) // 0x00 normal, 0x01 tall, 0x11 tall + wide
  const bold = (on) => push(ESC, 0x45, on ? 1 : 0)
  const align = (a) => push(ESC, 0x61, a)
  const wrap = (s, w) => { const o = []; let cur = ''; String(s).split(/\s+/).filter(Boolean).forEach((word) => { while (word.length > w) { if (cur) { o.push(cur); cur = '' } o.push(word.slice(0, w)); word = word.slice(w) } if (!cur) cur = word; else if ((cur + ' ' + word).length <= w) cur += ' ' + word; else { o.push(cur); cur = word } }); if (cur) o.push(cur); return o }
  const two = (l, r) => line(String(l).slice(0, cols - String(r).length - 1).padEnd(cols - String(r).length) + r)
  const t = kot.order?.table
  const parcel = t && /^parcel\b/i.test(String(t.number))
  const where = t ? (parcel ? `PARCEL ${String(t.number).replace(/^parcel\s*/i, '')}` : `TABLE ${t.number}`) : (kot.order?.type === 'delivery' ? 'DELIVERY' : 'TAKEAWAY')
  const when = new Date(kot.created_at)

  spacing(tight)
  align(1); bold(true)
  if (company?.name) wrap(company.name, cols).slice(0, 2).forEach(line)
  spacing(tight + 28)
  size(0x11); line(kot.type === 'cancel' ? 'STOP-CANCELLED' : `KOT #${kot.number}`); size(0)
  if (kot.type === 'cancel') { size(0x11); line(`KOT #${kot.number}`); size(0) }
  size(0x11); line(where); size(0)
  spacing(tight); bold(false)
  if (t?.section) line(t.section)
  align(0)
  push(ESC, 0x4a, 4)
  two(`Order: ${kot.order?.order_no || ''}`, timeIST(when))
  two(kot.sender?.name ? `By: ${kot.sender.name}` : '', dateIST(when))
  push(ESC, 0x4a, 6)
  const lines = kot.items || []
  lines.forEach((i, n) => {
    if (n > 0) push(ESC, 0x4a, 6) // air between dishes (no dotted lines)
    spacing(tight + 28); bold(true); size(0x01) // double height (full width): big enough to read, long names still fit
    const rows = wrap(i.name, cols - 5)
    line(`${String(i.quantity).padStart(2)}x ${rows[0] || ''}`)
    rows.slice(1).forEach((r) => line(`    ${r}`))
    size(0); bold(false); spacing(tight)
    if (i.variant) line(`    (${i.variant})`)
  })
  if (kot.note) { push(ESC, 0x4a, 6); bold(true); line('NOTE:'); size(0x01); wrap(kot.note, cols).forEach(line); size(0); bold(false) }
  push(ESC, 0x4a, 6)
  two(`Total items: ${lines.reduce((n, i) => n + Number(i.quantity), 0)}`, `Printed ${timeIST(new Date())}`)
  if (textTune.bottom() > 0) push(ESC, 0x64, textTune.bottom())
  push(GS, 0x56, 0x42, 0x00)
  return new Uint8Array(out)
}

/** @returns {Promise<Uint8Array>} ESC/POS raster bytes for one ticket */
export async function buildKotSlip(kot, company, opts = {}) {
  const { canvas, W, H } = await drawKotCanvas(kot, company, opts)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, W, H).data
  const rowBytes = W / 8
  const bytes = [ESC, 0x40]
  const BAND = 128
  for (let top = 0; top < H; top += BAND) {
    const h = Math.min(BAND, H - top)
    bytes.push(GS, 0x76, 0x30, 0, rowBytes & 255, rowBytes >> 8, h & 255, h >> 8)
    for (let r = 0; r < h; r++) {
      for (let bx = 0; bx < rowBytes; bx++) {
        let b = 0
        for (let bit = 0; bit < 8; bit++) {
          const p = ((top + r) * W + bx * 8 + bit) * 4
          if ((img[p] * 299 + img[p + 1] * 587 + img[p + 2] * 114) / 1000 < 150) b |= 0x80 >> bit
        }
        bytes.push(b)
      }
    }
  }
  bytes.push(ESC, 0x64, 3, GS, 0x56, 0x42, 0x00) // feed + partial cut
  return new Uint8Array(bytes)
}

/** Prints one ticket to this device's saved printer. Throws a readable Error when no printer was chosen / it fails. */
export async function printKot(kot, company, lang = 'en') {
  const conn = kotConnection()
  if (!conn) throw new Error('Choose a printer first (Print settings).')
  const plain = kotPrefs.style() === 'text' && lang !== 'mr' && !/[^\x20-\x7E\n]/.test(JSON.stringify([company?.name, kot.note, kot.order?.table?.section, kot.sender?.name, (kot.items || []).map((i) => [i.name, i.variant])]))
  const bytes = plain ? buildKotText(kot, company, { width: kotPrefs.width() }) : await buildKotSlip(kot, company, { width: kotPrefs.width(), lang })
  conn === 'usb' ? await printUsb(bytes, { delay: 4 }) : await printBluetooth(bytes, { delay: 5, chunk: 160, settle: 700 })
}
