// Kitchen slip (KOT) for thermal printers. Drawn on a canvas and sent as a picture so Marathi dish names print correctly
// (a plain ESC/POS printer has no Devanagari font), with big bold dishes that are easy to read in a hot kitchen.
import { printBluetooth, printUsb, savedPrinter } from './escpos'

const ESC = 0x1b
const GS = 0x1d
const FONT = '"Noto Sans Devanagari","Mukta","Nirmala UI","Kohinoor Devanagari","Mangal","Noto Sans","Segoe UI",Arial,sans-serif'

const get = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const put = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
export const kotPrefs = {
  width: () => (get('hms.kot.width', '80mm') === '58mm' ? '58mm' : '80mm'),
  setWidth: (v) => put('hms.kot.width', v),
  /** print a slip automatically: on the kitchen screen when a ticket arrives, on the order screen when an order is placed */
  auto: (where) => get(`hms.kot.auto.${where}`, '0') === '1',
  setAuto: (where, on) => put(`hms.kot.auto.${where}`, on ? '1' : '0'),
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

/** @returns {Promise<Uint8Array>} ESC/POS raster bytes for one ticket */
export async function buildKotSlip(kot, company, { width = '80mm', lang = 'en' } = {}) {
  await loadFonts()
  const mr = lang === 'mr'
  const L = mr
    ? { kot: 'केओटी', cancel: 'थांबवा – रद्द', table: 'टेबल', takeaway: 'पार्सल', delivery: 'डिलिव्हरी', order: 'ऑर्डर', by: 'वेटर', note: 'सूचना', items: 'एकूण' }
    : { kot: 'KOT', cancel: 'STOP - CANCELLED', table: 'TABLE', takeaway: 'TAKEAWAY', delivery: 'DELIVERY', order: 'Order', by: 'By', note: 'Note', items: 'Items' }
  const wide = width !== '58mm'
  const W = wide ? 576 : 384
  const pad = 6
  const lines = kot.items || []
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = 700 + lines.length * 140
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, canvas.height)
  ctx.fillStyle = '#000'
  let y = 4
  const font = (size, bold = true) => { ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}` }
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
  const center = (text, size, bold = true) => { font(size, bold); y += Math.round(size * 1.2); ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y); y += 4 }
  const pair = (l, r, size = 22, bold = false) => { font(size, bold); y += Math.round(size * 1.3); ctx.textAlign = 'left'; ctx.fillText(l, pad, y); ctx.textAlign = 'right'; ctx.fillText(r, W - pad, y) }
  const rule = (dash = true) => { y += 8; ctx.save(); ctx.lineWidth = 3; if (dash) ctx.setLineDash([8, 5]); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); ctx.restore(); y += 8 }

  const isCancel = kot.type === 'cancel'
  if (company?.name) center(company.name, 22, false)
  if (isCancel) {
    // white text on a black bar: impossible to miss
    y += 8
    ctx.fillRect(0, y, W, 56)
    ctx.fillStyle = '#fff'
    font(30); ctx.textAlign = 'center'; ctx.fillText(L.cancel, W / 2, y + 40)
    ctx.fillStyle = '#000'
    y += 62
  }
  center(`${L.kot} #${kot.number}`, wide ? 64 : 52)
  const t = kot.order?.table
  center(t ? `${L.table} ${t.number}${t.section ? ` · ${t.section}` : ''}` : (kot.order?.type === 'delivery' ? L.delivery : L.takeaway), wide ? 46 : 38)
  const when = new Date(kot.created_at)
  pair(`${L.order}: ${kot.order?.order_no || ''}`, when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }))
  if (kot.sender?.name) pair(`${L.by}: ${kot.sender.name}`, when.toLocaleDateString('en-IN'))
  rule(false)

  lines.forEach((i) => {
    const size = wide ? 34 : 30
    font(size)
    const label = `${i.name}${i.variant ? ` (${i.variant})` : ''}`
    const qtyW = 78
    wrap(label, W - pad * 2 - qtyW).forEach((ln, idx) => {
      y += Math.round(size * 1.25)
      if (idx === 0) { ctx.textAlign = 'left'; ctx.fillText(`${i.quantity} ×`, pad, y) }
      ctx.textAlign = 'left'; ctx.fillText(ln, pad + qtyW, y)
    })
    y += 8
  })
  rule()
  if (kot.note) {
    font(26); y += 6
    const noteLines = wrap(`${L.note}: ${kot.note}`, W - pad * 2 - 16)
    const h = noteLines.length * 34 + 14
    ctx.lineWidth = 3; ctx.strokeRect(pad, y, W - pad * 2, h)
    noteLines.forEach((ln, idx) => { ctx.textAlign = 'left'; ctx.fillText(ln, pad + 8, y + 32 + idx * 34) })
    y += h + 10
  }
  center(`${L.items}: ${lines.reduce((n, i) => n + Number(i.quantity), 0)}`, 22, false)
  y += 14

  const H = Math.min(canvas.height, y)
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
  const bytes = await buildKotSlip(kot, company, { width: kotPrefs.width(), lang })
  conn === 'usb' ? await printUsb(bytes, { delay: 12 }) : await printBluetooth(bytes, { delay: 12 })
}
