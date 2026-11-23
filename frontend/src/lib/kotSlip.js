// Kitchen slip (KOT) for thermal printers. Drawn on a canvas and sent as a picture so Marathi dish names print correctly
// (a plain ESC/POS printer has no Devanagari font), with big bold dishes that are easy to read in a hot kitchen.
import { isPlain, printBluetooth, printUsb, savedPrinter, textTune, toAscii } from './escpos'
import { dateIST, timeIST } from './format'

const ESC = 0x1b
const GS = 0x1d
const FONT = '"Noto Sans Devanagari","Mukta","Nirmala UI","Kohinoor Devanagari","Mangal","Noto Sans","Segoe UI",Arial,sans-serif'

const get = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const put = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const changed = () => { try { window.dispatchEvent(new Event('hms:kotprefs')) } catch { /* old browser */ } } // lets an open settings panel show the new value
export const kotPrefs = {
  width: () => (get('hms.kot.width', '80mm') === '58mm' ? '58mm' : '80mm'),
  setWidth: (v) => { put('hms.kot.width', v); changed() },
  /** 'picture' (default) or 'text': the fast plain-text slip (the printer's own English letters) */
  style: () => (get('hms.kot.style', 'picture') === 'text' ? 'text' : 'picture'),
  setStyle: (v) => put('hms.kot.style', v === 'text' ? 'text' : 'picture'),
  /** Language printed on the slip: 'en' | 'mr' | 'hi'. Not chosen = follow the app (Marathi app -> Marathi slip, otherwise English, as before). */
  lang: (appLang) => { const v = get('hms.kot.lang', null); return v === 'en' || v === 'mr' || v === 'hi' ? v : (appLang === 'mr' ? 'mr' : 'en') },
  /** the saved choice itself: 'auto' | 'en' | 'mr' | 'hi' */
  langChoice: () => { const v = get('hms.kot.lang', null); return v === 'en' || v === 'mr' || v === 'hi' ? v : 'auto' },
  setLang: (v) => { if (v === 'en' || v === 'mr' || v === 'hi') put('hms.kot.lang', v); else { try { localStorage.removeItem('hms.kot.lang') } catch { /* private mode */ } } },
  /** Bluetooth or USB for the kitchen printer on this device; null = never chosen (then Bluetooth is tried first, as before) */
  conn: () => { const v = get('hms.kot.conn', null); return v === 'usb' || v === 'bluetooth' ? v : null },
  setConn: (v) => put('hms.kot.conn', v === 'usb' ? 'usb' : 'bluetooth'),
  /** true when this device has its OWN kitchen printer (not the bill printer) */
  hasOwnPrinter: () => !!(savedPrinter('bluetooth', 'kot') || savedPrinter('usb', 'kot')),
  /** print a slip automatically: on the kitchen screen when a ticket arrives, on the order screen when an order is placed */
  auto: (where) => get(`hms.kot.auto.${where}`, '0') === '1',
  setAuto: (where, on) => put(`hms.kot.auto.${where}`, on ? '1' : '0'),
  /** what happens to the printed slip when an order is placed on THIS device: 'off' | 'ask' (Yes/No popup) | 'auto' */
  orderMode: (companyDefault) => { const m = get('hms.kot.mode.order', null); return m === 'ask' || m === 'auto' || m === 'off' ? m : (get('hms.kot.auto.order', '0') === '1' ? 'auto' : (['auto', 'ask', 'off'].includes(companyDefault) ? companyDefault : 'off')) }, // this device's own choice, else the platform admin's default for the company, else off
  setOrderMode: (m) => { put('hms.kot.mode.order', m); put('hms.kot.auto.order', m === 'auto' ? '1' : '0') },
}

const usable = (kind, job) => !!savedPrinter(kind, job) && (kind === 'usb' ? !!navigator.usb : !!navigator.bluetooth)

/**
 * Which printer a kitchen slip goes to on this device (null = none chosen yet):
 * 1. the device's own kitchen printer (Settings -> Kitchen slip printer), else
 * 2. the bill printer, which is how every device printed slips before a separate kitchen printer existed.
 * @returns {{ kind: 'bluetooth'|'usb', job: 'kot'|'bill', name: string } | null}
 */
export function kotConnection() {
  const pref = kotPrefs.conn()
  const kinds = pref === 'usb' ? ['usb', 'bluetooth'] : ['bluetooth', 'usb']
  for (const job of ['kot', 'bill']) {
    for (const kind of kinds) if (usable(kind, job)) return { kind, job, name: savedPrinter(kind, job)?.name || '' }
  }
  return null
}

/** True when the kitchen printer chosen on this device is the very same printer as the bill printer (allowed: jobs simply queue). */
export function kotSharesBillPrinter() {
  const c = kotConnection()
  if (!c || c.job !== 'kot') return false
  const a = savedPrinter(c.kind, 'kot')
  const b = savedPrinter(c.kind, 'bill')
  if (!a || !b) return false
  return c.kind === 'bluetooth' ? a.id === b.id : a.vendorId === b.vendorId && a.productId === b.productId && (a.serialNumber || null) === (b.serialNumber || null)
}

/** Words printed on the slip, per slip language. */
export const KOT_LABELS = {
  en: { kot: 'KOT', cancel: 'STOP - CANCELLED', table: 'TABLE', parcel: 'PARCEL', takeaway: 'TAKEAWAY', delivery: 'DELIVERY', order: 'Order', by: 'By', note: 'NOTE', items: 'Total items', printed: 'Printed' },
  mr: { kot: 'केओटी', cancel: 'थांबवा – रद्द', table: 'टेबल', parcel: 'पार्सल', takeaway: 'पार्सल', delivery: 'डिलिव्हरी', order: 'ऑर्डर', by: 'वेटर', note: 'सूचना', items: 'एकूण डिश', printed: 'प्रिंट' },
  hi: { kot: 'केओटी', cancel: 'रुकें – रद्द', table: 'टेबल', parcel: 'पार्सल', takeaway: 'टेकअवे', delivery: 'डिलीवरी', order: 'ऑर्डर', by: 'वेटर', note: 'सूचना', items: 'कुल डिश', printed: 'प्रिंट' },
}
const labels = (lang) => KOT_LABELS[lang] || KOT_LABELS.en

/** The dish name on the slip: the Marathi name on a Marathi slip (the server sends `name_mr`), otherwise the name as ordered. */
export const kotDishName = (i, lang) => (lang === 'mr' && i.name_mr ? i.name_mr : i.name)
/** The size / variant on the slip: its Marathi name on a Marathi slip when the owner entered one (the server sends `variant_mr`). */
export const kotVariantName = (i, lang) => (lang === 'mr' && i.variant_mr ? i.variant_mr : i.variant)

/**
 * 'text' (Fast text) or 'picture' (Neat picture), as chosen on this device. Fast text works in every language: lines with plain English
 * letters use the printer's own font, and only lines with Marathi / Hindi letters are sent as small pictures (much less data than a
 * whole-slip picture). The app language no longer turns Fast text into the slow full picture.
 */
export function kotStyleFor() {
  return kotPrefs.style()
}

async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load('400 24px "Noto Sans Devanagari"', 'अआइ'), document.fonts.load('600 24px "Noto Sans Devanagari"', 'अआइ'), document.fonts.load('700 24px "Noto Sans Devanagari"', 'अआइ'),
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
  const L = labels(lang)
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

  // where it goes: table / parcel / takeaway / delivery
  const t = kot.order?.table
  const parcel = t && /^parcel\b/i.test(String(t.number))
  const where = t ? (parcel ? `${L.parcel} ${String(t.number).replace(/^parcel\s*/i, '')}` : `${L.table} ${t.number}`) : (kot.order?.type === 'delivery' ? L.delivery : L.takeaway)

  // 2. the big ticket number (a cancelled ticket gets the STOP bar instead, so only one black bar is ever on the slip)
  if (isCancel) {
    bar(L.cancel, 34, 66)
    y += Math.round(6 * k)
    center(`${L.kot} #${kot.number}`, 64)
  } else {
    // KOT number and table / parcel / takeaway side by side on ONE line, two outlined boxes (the font shrinks until both fit)
    const kotTxt = `${L.kot} #${kot.number}`
    let fs = 60
    const fit = () => { font(fs); return ctx.measureText(kotTxt).width + ctx.measureText(where).width + Math.round(120 * k) }
    while (fs > 22 && fit() > W - pad * 2 - Math.round(12 * k)) fs -= 2
    font(fs)
    const w1 = ctx.measureText(kotTxt).width + Math.round(40 * k)
    const w2 = ctx.measureText(where).width + Math.round(40 * k)
    const gapX = Math.round(10 * k)
    const x0 = Math.round((W - (w1 + gapX + w2)) / 2)
    const bh2 = Math.round(Math.max(fs * 1.5, 56 * k))
    ctx.lineWidth = Math.max(3, Math.round(5 * k))
    ctx.strokeRect(x0, y + 2, w1, bh2); ctx.strokeRect(x0 + w1 + gapX, y + 2, w2, bh2)
    ctx.textAlign = 'center'
    const ty = y + 2 + bh2 / 2 + Math.round(fs * 0.35)
    ctx.fillText(kotTxt, x0 + w1 / 2, ty); ctx.fillText(where, x0 + w1 + gapX + w2 / 2, ty)
    y += bh2 + Math.round(6 * k)
    if (t?.section) center(t.section, 26, false)
  }

  // 3. where it goes: table (boxed) / takeaway / delivery
  if (isCancel) {
  y += Math.round(12 * k)
  font(54)
  const bw = Math.min(W - pad * 2, ctx.measureText(where).width + Math.round(60 * k))
  const bh = Math.round(76 * k)
  ctx.lineWidth = Math.max(3, Math.round(5 * k))
  ctx.strokeRect(Math.round((W - bw) / 2), y, bw, bh)
  ctx.textAlign = 'center'; ctx.fillText(where, W / 2, y + bh / 2 + Math.round(54 * k * 0.35))
  y += bh
  if (t?.section) center(t.section, 26, false)
  }

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
    const nameLines = wrap(kotDishName(i, lang), W - pad * 2 - qb - gap)
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
    if (i.variant) { font(varSize, false); ctx.fillText(`(${kotVariantName(i, lang)})`, pad + qb + gap, top + nameLines.length * nameH - Math.round(4 * k)) }
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

/**
 * Fast slip: lines with plain English letters use the printer's own font (no picture to send), big bold dishes.
 * A line with Marathi / Hindi letters (the printer has no Devanagari font) is drawn as a small picture just that line high, so a
 * Marathi slip stays fast: only those lines are pictures, not the whole slip. An all-English slip contains no pictures at all.
 * Needs the fonts loaded (printKot does that) when a slip has Devanagari.
 */
function buildKotTextOnce(kot, company, { width = '80mm', lang = 'en', dishPx } = {}) {
  const narrow = width === '58mm'
  const cols = narrow ? 32 : 48
  const out = [ESC, 0x40, ESC, 0x4d, 0] // Font A: 32 / 48 letters per line, so everything lines up
  const enc = new TextEncoder()
  const push = (...b) => out.push(...b)
  const txt = (s) => push(...enc.encode(toAscii(s).replace(/[^\x20-\x7E\n]/g, '?')))
  const line = (s = '') => txt(`${s}\n`)
  const tight = textTune.spacing('kot')
  const spacing = (n) => push(ESC, 0x33, n)
  const size = (n) => push(GS, 0x21, n) // 0x00 normal, 0x01 tall, 0x11 tall + wide
  const bold = (on) => push(ESC, 0x45, on ? 1 : 0)
  const lite = (on) => push(ESC, 0x47, on ? 1 : 0) // double-strike: a touch darker than normal, lighter than bold (printers only have on / off for bold)
  let aligned = 0
  const align = (a) => { aligned = a; push(ESC, 0x61, a) }
  const wrap = (s, w) => { const o = []; let cur = ''; String(s).split(/\s+/).filter(Boolean).forEach((word) => { while (word.length > w) { if (cur) { o.push(cur); cur = '' } o.push(word.slice(0, w)); word = word.slice(w) } if (!cur) cur = word; else if ((cur + ' ' + word).length <= w) cur += ' ' + word; else { o.push(cur); cur = word } }); if (cur) o.push(cur); return o }
  const two = (l, r) => line(String(l).slice(0, cols - String(r).length - 1).padEnd(cols - String(r).length) + r)
  const L = { ...KOT_LABELS.en, items: 'Items' } // headings and labels stay plain English text on a Fast slip (free); only the dish names (and any Marathi / Hindi note) are pictures
  const t = kot.order?.table
  const parcel = t && /^parcel\b/i.test(String(t.number))
  const where = t ? (parcel ? `${L.parcel} ${String(t.number).replace(/^parcel\s*/i, '')}` : `${L.table} ${t.number}`) : (kot.order?.type === 'delivery' ? L.delivery : L.takeaway)
  const when = new Date(kot.created_at)

  // a solid black band 3 dots tall: a clean line that takes no blank paper above or below it
  const rb = (narrow ? 384 : 576) / 8
  const W = rb * 8
  const dark = () => { push(GS, 0x76, 0x30, 0, rb & 255, rb >> 8, 3, 0); for (let i = 0; i < rb * 3; i++) out.push(0xff) }

  // ── lines as small pictures (only for Marathi / Hindi text) ──
  const PX = { small: narrow ? 22 : 26, dish: dishPx || (narrow ? 32 : 40), head: narrow ? 34 : 44 } // ≈ the printer's normal / tall / tall+wide letters
  let pad = null
  const canvas = () => pad || (pad = (() => { const c = document.createElement('canvas'); c.width = W; c.height = 8; return { c, ctx: c.getContext('2d', { willReadFrequently: true }) } })())
  const fontOf = (px, b) => `${b === true ? 700 : b || 400} ${px}px ${FONT}` // b: true = bold (700), a number = that weight, false = regular
  const measure = (s, px, b) => { const { ctx } = canvas(); ctx.font = fontOf(px, b); return ctx.measureText(s).width }
  const wrapPx = (s, px, b, maxW) => {
    const o = []
    let cur = ''
    String(s).split(/\s+/).filter(Boolean).forEach((word) => { const trial = cur ? `${cur} ${word}` : word; if (!cur || measure(trial, px, b) <= maxW) cur = trial; else { o.push(cur); cur = word } })
    if (cur) o.push(cur)
    return o
  }
  /** rows: [{ px, bold, parts: [{ text, x, align: 'left'|'center'|'right' }] }] -> raster bands (full paper width) */
  const raster = (rows) => {
    const { c, ctx } = canvas()
    const hOf = (r) => Math.round(r.px * 1.6) // Devanagari needs room above (matra / shirorekha) and below the line
    const H = rows.reduce((n, r) => n + hOf(r), 0)
    c.height = H
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000'
    let y = 0
    rows.forEach((r) => {
      ctx.font = fontOf(r.px, r.bold)
      r.parts.forEach((p) => { ctx.textAlign = p.align || 'left'; ctx.fillText(p.text, p.align === 'center' ? W / 2 : p.align === 'right' ? W - 2 : (p.x || 0) + 2, y + Math.round(r.px * 1.12)) })
      y += hOf(r)
    })
    const img = ctx.getImageData(0, 0, W, H).data
    // 1 bit per dot, then send as little as possible: blank rows above / below become a paper feed, and each band is only as wide
    // as its rightmost black dot (the picture is left-aligned, so nothing moves). A short Marathi word costs a fraction of a full line.
    const bits = []
    for (let yy = 0; yy < H; yy++) {
      const row = new Uint8Array(rb)
      for (let bx = 0; bx < rb; bx++) {
        let v = 0
        for (let bit = 0; bit < 8; bit++) { const p = (yy * W + bx * 8 + bit) * 4; if ((img[p] * 299 + img[p + 1] * 587 + img[p + 2] * 114) / 1000 < 150) v |= 0x80 >> bit }
        row[bx] = v
      }
      bits.push(row)
    }
    const used = (r) => { for (let i = r.length - 1; i >= 0; i--) if (r[i]) return i + 1; return 0 }
    let first = 0; while (first < H && !used(bits[first])) first++
    let last = H - 1; while (last > first && !used(bits[last])) last--
    const feed = (n) => { while (n > 0) { const f = Math.min(255, n); push(ESC, 0x4a, f); n -= f } }
    if (first >= H) { feed(H); return } // nothing drawn
    const keep = aligned
    if (keep) push(ESC, 0x61, 0) // a cropped picture must start at the left edge (some printers centre pictures too)
    feed(first)
    for (let top = first; top <= last; top += 128) {
      const h = Math.min(128, last + 1 - top)
      let w = 1
      for (let yy = 0; yy < h; yy++) w = Math.max(w, used(bits[top + yy]))
      push(GS, 0x76, 0x30, 0, w & 255, w >> 8, h & 255, h >> 8)
      for (let yy = 0; yy < h; yy++) for (let bx = 0; bx < w; bx++) out.push(bits[top + yy][bx])
    }
    feed(H - 1 - last)
    if (keep) push(ESC, 0x61, keep)
  }
  const pic = (text, px, { b = false, center = false, x = 0 } = {}) => raster(wrapPx(text, px, b, W - x - 4).map((l) => ({ px, bold: b, parts: [{ text: l, x, align: center ? 'center' : 'left' }] })))
  const picTwo = (l, r, px, b = false) => raster([{ px, bold: b, parts: [{ text: l, align: 'left' }, { text: r, align: 'right' }] }])

  // 1. shop name (small, centered, not bold)
  spacing(tight)
  align(1)
  if (company?.name && isPlain(company.name)) wrap(toAscii(company.name), cols).slice(0, 2).forEach(line) // a Marathi / Hindi shop name is left off: a centred picture would cost a whole line of data
  align(0)
  dark()

  // 2. KOT number and table / parcel / takeaway on ONE line: wide letters, not bold (normal width when it would not fit)
  if (kot.type === 'cancel') { if (isPlain(L.cancel)) { align(1); size(0x10); line(L.cancel.slice(0, cols / 2)); size(0); align(0) } else pic(L.cancel, PX.head, { b: true, center: true }) }
  const kotTxt = `${L.kot} #${kot.number}`
  const sec = t?.section ? ` (${t.section})` : ''
  if (isPlain(kotTxt + where)) {
    const head = kotTxt + ' '.repeat(Math.max(1, Math.floor(cols / 2) - kotTxt.length - where.length)) + where
    // big, bold and clear: double width AND height (the most important line of the slip)
    spacing(52); bold(true)
    if (head.length <= cols / 2) { size(0x11); line(head); size(0) } else { align(1); size(0x11); line(kotTxt.slice(0, cols / 2)); line(where.slice(0, cols / 2)); size(0); align(0) }
    bold(false); spacing(tight)
  } else if (measure(kotTxt, PX.head, true) + measure(where, PX.head, true) + 24 <= W) picTwo(kotTxt, where, PX.head, true)
  else { pic(kotTxt, PX.head, { b: true, center: true }); pic(where, PX.head, { b: true, center: true }) }
  if (sec) { if (isPlain(sec)) line(sec.trim()); else pic(sec.trim(), PX.small) }
  dark()

  // 3. order details (on a narrow slip the date and time share a line, so nothing gets cut off)
  const orderLine = `${L.order}: ${kot.order?.order_no || ''}`
  if (isPlain(orderLine)) line(orderLine); else pic(orderLine, PX.small)
  two(dateIST(when), timeIST(when))
  if (kot.sender?.name) { const by = `${L.by}: ${kot.sender.name}`; if (isPlain(by)) line(toAscii(by).slice(0, cols)); else pic(by, PX.small) }
  dark()

  // 4. dishes: every dish the SAME size: bold, double height, full width (long names wrap under the name)
  const lines = kot.items || []
  lines.forEach((i) => {
    const q = `${i.quantity}x`
    const name = kotDishName(i, lang)
    if (isPlain(name)) {
      const rows = wrap(toAscii(name), cols - q.length - 1)
      spacing(48); bold(true); size(0x01)
      line(`${q} ${rows[0] || ''}`)
      rows.slice(1).forEach((r) => line(' '.repeat(q.length + 1) + r))
      size(0); bold(false); spacing(tight)
    } else {
      const x = measure(`${q} `, PX.dish, 600)
      const rows = wrapPx(name, PX.dish, 600, W - x - 4)
      raster(rows.map((r, n) => ({ px: PX.dish, bold: 600, parts: n === 0 ? [{ text: q }, { text: r, x }] : [{ text: r, x }] })))
    }
    if (i.variant) { const vn = kotVariantName(i, lang); if (isPlain(vn)) line(`   (${vn})`); else pic(`(${vn})`, PX.small, { x: measure('   ', PX.small) }) }
  })
  push(ESC, 0x4a, 3)
  dark()
  if (kot.note) {
    push(ESC, 0x4a, 4)
    if (isPlain(L.note) && isPlain(kot.note)) { line(`${L.note}:`); lite(true); wrap(toAscii(kot.note), cols).forEach(line); lite(false) } else { pic(`${L.note}:`, PX.small); pic(kot.note, PX.small) }
    push(ESC, 0x4a, 4); dark()
  }

  // 5. footer
  const count = `${L.items}: ${lines.reduce((n, i) => n + Number(i.quantity), 0)}`
  const printed = `${L.printed} ${timeIST(new Date())}`
  if (isPlain(count + printed)) two(count, printed); else picTwo(count, printed, PX.small)
  if (textTune.bottom('kot') > 0) push(ESC, 0x64, textTune.bottom('kot'))
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

/**
 * Prints one ticket to this device's kitchen printer (or the bill printer when it has no separate one).
 * Throws a readable Error when no printer was chosen / it fails.
 * @returns {Promise<'text'|'picture'>} how the slip was printed
 */
export async function printKot(kot, company, lang = 'en') {
  const conn = kotConnection()
  if (!conn) throw new Error('Choose a printer first (Print settings).')
  const style = kotStyleFor()
  const width = kotPrefs.width()
  const kl = kotPrefs.lang(lang) // this device's slip language (not chosen: follows the app)
  if (style === 'text') await loadFonts() // lines with Marathi / Hindi letters are drawn with the phone's fonts
  const bytes = style === 'text' ? buildKotText(kot, company, { width, lang: kl }) : await buildKotSlip(kot, company, { width, lang: kl })
  if (conn.kind === 'usb') await printUsb(bytes, { delay: 4, job: conn.job })
  else await printBluetooth(bytes, { delay: 5, chunk: 160, settle: 700, job: conn.job })
  return style
}

/**
 * The fast slip: the headings are plain text, so the only pictures are the Marathi / Hindi dish names. They are printed BIG and bold
 * (readable at a glance in a hot kitchen); only a long order steps down a little, never below a clear reading size, to keep the data
 * small (about 7 KB for 4 long pizza names, 2-3 KB for a short order; an English-only slip is ~1 KB).
 */
export function buildKotText(kot, company, opts = {}) {
  const narrow = opts.width === '58mm'
  const budget = narrow ? 5200 : 8000
  const sizes = opts.sizes || (narrow ? [35, 33, 31, 29] : [44, 40, 37, 35, 33])
  let bytes
  for (const px of sizes) {
    bytes = buildKotTextOnce(kot, company, { ...opts, dishPx: px })
    if (bytes.length <= budget) break
  }
  return bytes
}

/** A sample slip for Settings -> "Test print" (nothing is saved or marked printed). */
export function printKotTest(company, user, lang = 'en') {
  const now = new Date().toISOString()
  return printKot({
    number: 1, type: 'add', created_at: now, note: null, sender: user?.name ? { name: user.name } : null,
    order: { order_no: 'TEST', type: 'dine_in', table: { number: '1', section: null } },
    items: [{ name: 'Test dish', name_mr: 'टेस्ट डिश', variant: null, quantity: 1 }, { name: 'Paneer Tikka', name_mr: 'पनीर टिक्का', variant: 'Full', quantity: 2 }],
  }, company, lang)
}
