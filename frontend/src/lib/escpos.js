// Minimal ESC/POS encoder + Web USB / Web Bluetooth transport. Chromium-based browsers only.
// Network printers cannot be reached directly from a browser (no raw TCP) — they use the browser-print fallback
// or a local print agent. Settings are still stored per company/branch.

import { dateIST, timeIST } from './format'

const ESC = 0x1b
const GS = 0x1d

/** Fast-text tuning for THIS device (every printer spaces its lines a little differently): line spacing in dots and blank lines left below the last line.
 *  The kitchen (KOT) printer can have its own values (`job` = 'kot'); until it does it uses the bill printer's. */
const num = (k, d, lo, hi) => { try { const v = Number(localStorage.getItem(k)); return localStorage.getItem(k) === null || Number.isNaN(v) ? d : Math.min(hi, Math.max(lo, v)) } catch { return d } }
const tuneKey = (k, job) => (job === 'kot' ? `hms.kot.text.${k}` : `hms.text.${k}`)
export const textTune = {
  spacing: (job) => num(tuneKey('spacing', job), job === 'kot' ? textTune.spacing() : 24, 12, 48),
  bottom: (job) => num(tuneKey('bottom', job), job === 'kot' ? textTune.bottom() : 0, 0, 8),
  set: (k, v, job) => { try { localStorage.setItem(tuneKey(k, job), String(v)) } catch { /* private mode */ } },
}

/** Common characters that have a plain-English twin (phone keyboards type curly quotes and long dashes; "Café" has an accent).
 *  Anything left that is not plain English (Marathi letters, emoji) would print as "?" on a text slip. */
const TWIN = { '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00d7': 'x', '\u20b9': 'Rs', '\u00a0': ' ', '\u2022': '*', '\t': ' ', '\r': '' }
export const toAscii = (s) => String(s ?? '').replace(/[\u2018\u2019\u201a\u201c\u201d\u2013\u2014\u2026\u00d7\u20b9\u00a0\u2022\t\r]/g, (c) => TWIN[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
/** True when the text prints correctly with the printer's own (English) letters. */
export const isPlain = (s) => !/[^\x20-\x7E\n]/.test(toAscii(s)) // eslint-disable-line no-control-regex

const enc = new TextEncoder()

export function buildReceipt({ bill, company, table, order_no, waiter, printer, customer_name }) {
  const wide = printer?.paper_width !== '58mm'
  const cols = wide ? 48 : 32
  const out = []
  const push = (...b) => out.push(...b)
  const text = (s) => out.push(...enc.encode(String(s).replace(/[^\x20-\x7E\n]/g, '?')))
  const line = (s = '') => text(s + '\n')
  // Rules: a line of "_" letters. It sits at the bottom of its row, so it touches the line above with no gap. (Some printers print "-" and "="
  // as blank, and underlined blanks as nothing, so "_" is the one that works everywhere.) '=' is the same line in bold = a heavier rule.
  // The dark line is a solid black band exactly 3 dots tall (a tiny picture: ~150 bytes). Unlike a line of "_" letters it takes NO blank row, so there is no
  // empty paper above or below it (the printer clamps the line spacing of letter rows, so letters can never get closer than a full row).
  const dark = () => {
    const rb = (wide ? 576 : 384) / 8
    push(GS, 0x76, 0x30, 0, rb & 255, rb >> 8, 3, 0)
    for (let i = 0; i < rb * 3; i++) out.push(0xff)
  }
  const rule = (ch = '-') => {
    if (ch === '=') push(ESC, 0x45, 1)
    line('_'.repeat(cols))
    if (ch === '=') push(ESC, 0x45, 0)
  }
  const two = (l, r) => line(String(l).slice(0, cols - String(r).length - 1).padEnd(cols - String(r).length) + r)
  const money = (n) => Number(n).toFixed(2)
  const center = (s) => { push(ESC, 0x61, 1); line(s); push(ESC, 0x61, 0) }
  const wrap = (s, w) => { const o = []; let cur = ''; String(s).split(/\s+/).forEach((word) => { while (word.length > w) { if (cur) { o.push(cur); cur = '' } o.push(word.slice(0, w)); word = word.slice(w) } if (!cur) cur = word; else if ((cur + ' ' + word).length <= w) cur += ' ' + word; else { o.push(cur); cur = word } }); if (cur) o.push(cur); return o }
  const bold = (on) => push(ESC, 0x45, on ? 1 : 0)
  const size = (n) => push(GS, 0x21, n) // 0x00 normal, 0x01 tall, 0x11 tall + wide

  push(ESC, 0x40) // init
  push(ESC, 0x4d, 0) // Font A (12x24): exactly 32 letters per line on 58 mm and 48 on 80 mm, so the columns below line up (many printers start in the narrow Font B)
  const spacing = (n) => push(ESC, 0x33, n) // line spacing in dots; big letters need more, or the lines touch
  const tight = textTune.spacing()
  spacing(tight) // tight (the printer default leaves a visible gap between lines); adjustable in Settings

  rule() // a line at the very start of the print

  // ── Header ──
  push(ESC, 0x61, 1)
  bold(true)
  const name = String(company.name || '')
  wrap(name, cols).forEach(line) // the shop name: bold, normal size (smaller than before, and no extra line spacing needed)
  bold(false)
  if (company.bill_header) wrap(company.bill_header, cols).forEach(line)
  if (company.address) wrap(company.address, cols).forEach(line)
  if (company.phone) line(`Ph: ${company.phone}`)
  const gstOn = company.gst_enabled !== false
  if (gstOn && company.gst_number) line(`GSTIN: ${company.gst_number}`)
  push(ESC, 0x61, 0)
  rule('=')

  // ── Bill details ──
  const d = new Date(bill.created_at)
  const when = `${dateIST(d)} ${timeIST(d)}`
  const twoS = (l, r) => String(l).slice(0, cols - String(r).length - 1).padEnd(cols - String(r).length) + String(r)
  const det = []
  if (wide) det.push(twoS(`Bill: ${bill.bill_no}`, when))
  else { det.push(`Bill: ${bill.bill_no}`); det.push(when) }
  if (table) det.push(/^parcel\b/i.test(String(table)) ? String(table) : `Table: ${table}`) // the waiter's name is not printed on the bill
  if (customer_name) det.push(`Customer: ${customer_name}`)
  det.forEach((t) => line(t))
  dark() // dark line above the ITEM / QTY / AMT heading

  // ── Items: ITEM  QTY  [RATE]  AMOUNT ──
  const wQ = 4, wR = wide ? 9 : 0, wA = 9
  const wN = cols - wQ - wR - wA - 1
  const num = (v, w) => String(v).padStart(w)
  bold(true)
  line('ITEM'.padEnd(wN + 1) + num('QTY', wQ) + (wide ? num('RATE', wR) : '') + num('AMT', wA))
  bold(false)
  dark() // dark line below it
  let qty = 0
  bill.items.forEach((i) => {
    qty += Number(i.quantity)
    const rows = wrap(i.name, wN)
    const amt = money(i.price * i.quantity - i.discount + Number(i.tax))
    line(rows[0].padEnd(wN + 1) + num(i.quantity, wQ) + (wide ? num(money(i.price), wR) : '') + num(amt, wA))
    rows.slice(1).forEach((r) => line('  ' + r))
  })

  // ── Totals ──
  const tot = [['Subtotal', money(bill.subtotal)]]
  if (Number(bill.discount)) tot.push(['Discount', `-${money(bill.discount)}`])
  if (gstOn && Number(bill.tax)) tot.push(['GST', money(bill.tax)])
  tot.forEach(([l, r]) => two(l, r))
  dark() // line above TOTAL
  size(0x10) // double WIDTH only: a bold, wide TOTAL that is no taller than a normal line, so no extra space above or below it
  const total = money(bill.grand_total)
  line('TOTAL'.padEnd(Math.max(1, cols / 2 - total.length)) + total)
  size(0)
  dark() // line below TOTAL (it also separates the thank-you line)
  // (no "Paid (cash)" line on the Fast text bill)

  // ── Footer ──
  push(ESC, 0x61, 1)
  bold(true)
  wrap(company.bill_footer || 'Thank you! Visit again.', cols).forEach(line)
  bold(false)
  push(ESC, 0x61, 0)
  if (textTune.bottom() > 0) push(ESC, 0x64, textTune.bottom()) // extra blank lines below the last line (default 0: the cut command already feeds the paper to the blade; adjustable in Settings)
  push(GS, 0x56, 0x42, 0x00) // partial cut (ignored by printers without a cutter)
  return new Uint8Array(out)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// `delay` (ms) paces big jobs such as picture receipts so a small printer buffer is never overrun
async function chunked(write, bytes, size, delay = 0) {
  for (let i = 0; i < bytes.length; i += size) { await write(bytes.slice(i, i + size)); if (delay) await sleep(delay) }
}

// ───────── Remembered printers ─────────
// The browser only shows its "choose a printer" popup the FIRST time. We remember the choice (this device + browser), so every
// later print connects straight to the same printer with no popup. "Forget" (Settings) clears it.
// A device can have TWO printers: one for bills ('bill': the original keys, kept so existing devices keep their printer) and one for
// kitchen slips ('kot'). Each job has its own saved Bluetooth and USB printer, so choosing one never replaces the other.
const KEY = {
  bill: { usb: 'hms.printer.usb', bluetooth: 'hms.printer.bt' },
  kot: { usb: 'hms.printer.kot.usb', bluetooth: 'hms.printer.kot.bt' },
}
const slot = (job) => (job === 'kot' ? KEY.kot : KEY.bill)
const read = (kind, job) => { try { return JSON.parse(localStorage.getItem(slot(job)[kind]) || 'null') } catch { return null } }
const write = (kind, job, v) => { try { localStorage.setItem(slot(job)[kind], JSON.stringify(v)) } catch { /* private mode */ } }

const cached = { bill: null, kot: null } // the Bluetooth device already found for each job in this session
export const savedPrinter = (kind, job = 'bill') => read(kind, job)
export const forgetPrinter = (kind, job = 'bill') => { try { localStorage.removeItem(slot(job)[kind]) } catch { /* ignore */ } if (kind === 'bluetooth') cached[job === 'kot' ? 'kot' : 'bill'] = null }

// One print at a time per printer: two jobs sent at once (two new tickets, or a bill and a slip that end up on the same printer)
// would otherwise clash on the same Bluetooth / USB link. Different printers still print at the same time.
const lanes = new Map()
function inLane(key, fn) {
  const run = (lanes.get(key) || Promise.resolve()).catch(() => {}).then(fn)
  lanes.set(key, run)
  run.finally(() => { if (lanes.get(key) === run) lanes.delete(key) }).catch(() => {})
  return run
}

const BT_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000ff00-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455']

const friendly = (e) => {
  if (e?.name === 'NotFoundError' || /cancel/i.test(e?.message || '')) return new Error('No printer selected. Tap Print again and choose your printer once.')
  if (e?.name === 'NetworkError') return new Error('Could not reach the printer. Switch it on, keep it close, then try again.')
  if (e?.name === 'SecurityError') return new Error('Printer access is blocked by the browser. Allow Bluetooth/USB for this site.')
  return e
}

async function btDevice(forcePick, job) {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is not supported in this browser. Use Chrome/Edge on Android/desktop or browser print.')
  const j = job === 'kot' ? 'kot' : 'bill'
  if (!forcePick) {
    if (cached[j]) return cached[j]
    const saved = read('bluetooth', j)
    if (saved && navigator.bluetooth.getDevices) {
      const known = (await navigator.bluetooth.getDevices()).find((d) => d.id === saved.id)
      if (known) return (cached[j] = known)
    }
  }
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES })
  write('bluetooth', j, { id: device.id, name: device.name || 'Bluetooth printer' })
  return (cached[j] = device)
}

const isPrinter = (d) => d.configurations.some((c) => c.interfaces.some((f) => f.alternates.some((a) => a.interfaceClass === 7)))
const sameUsb = (d, s) => !!s && d.vendorId === s.vendorId && d.productId === s.productId && (!s.serialNumber || d.serialNumber === s.serialNumber)

async function usbDevice(forcePick, job) {
  if (!navigator.usb) throw new Error('WebUSB is not supported in this browser. Use Chrome/Edge or browser print.')
  const j = job === 'kot' ? 'kot' : 'bill'
  if (!forcePick) {
    const saved = read('usb', j)
    const devices = await navigator.usb.getDevices()
    let known = saved ? devices.find((d) => sameUsb(d, saved)) : null
    if (!saved) { // nothing chosen for this job: any USB printer, but not the one chosen for the OTHER job
      const other = read('usb', j === 'kot' ? 'bill' : 'kot')
      const printers = devices.filter(isPrinter)
      known = printers.find((d) => !sameUsb(d, other)) || printers[0]
    }
    if (known) return known
  }
  const device = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }] })
  write('usb', j, { vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber || null, name: device.productName || 'USB printer' })
  return device
}

/** Settings -> "Choose printer": runs the browser popup once and remembers the result for that job ('bill' or 'kot'). */
export async function pairPrinter(kind, job = 'bill') {
  try {
    if (kind === 'usb') return (await usbDevice(true, job)).productName || 'USB printer'
    return (await btDevice(true, job)).name || 'Bluetooth printer'
  } catch (e) { throw friendly(e) }
}

export async function printUsb(bytes, { delay = 0, job = 'bill' } = {}) {
  try {
    const device = await usbDevice(false, job)
    await inLane(`usb:${device.vendorId}:${device.productId}:${device.serialNumber || ''}`, () => sendUsb(device, bytes, delay))
  } catch (e) { throw friendly(e) }
}

async function sendUsb(device, bytes, delay) {
  if (!device.opened) await device.open()
  if (!device.configuration) await device.selectConfiguration(1)
  const iface = device.configuration.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 7))
  if (!iface) throw new Error('No printer interface found on this device')
  if (!iface.claimed) await device.claimInterface(iface.interfaceNumber)
  const ep = iface.alternates[0].endpoints.find((e) => e.direction === 'out')
  await chunked((c) => device.transferOut(ep.endpointNumber, c), bytes, 64, delay)
  await device.close()
}

// The Bluetooth link is kept for a short while after a print, so the NEXT print skips the slow connect + service search
// (the slowest part of a small print). It is dropped after 45 s idle so the printer is free for other devices.
// One link per printer: a device with a bill printer AND a kitchen printer keeps both links.
const links = new Map() // device.id -> { char, timer }
const dropLink = (device) => { const l = links.get(device.id); if (l) clearTimeout(l.timer); links.delete(device.id); try { device.gatt?.disconnect() } catch { /* ignore */ } }

export async function printBluetooth(bytes, { delay = 0, chunk = 100, settle = 1200, job = 'bill' } = {}) {
  const send = async (device) => {
    const link = links.get(device.id)
    let w = link && device.gatt.connected ? link.char : null
    if (!w) {
      const server = device.gatt.connected ? device.gatt : await device.gatt.connect()
      const services = await server.getPrimaryServices()
      for (const s of services) {
        const chars = await s.getCharacteristics()
        w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse) || null
        if (w) break
      }
      if (!w) throw new Error('No writable printer characteristic found')
      links.set(device.id, { char: w, timer: null })
    }
    await chunked((c) => (w.properties.writeWithoutResponse ? w.writeValueWithoutResponse(c) : w.writeValue(c)), bytes, chunk, delay)
    if (delay) await sleep(settle) // let the printer finish its buffer
    const l = links.get(device.id)
    if (l) { clearTimeout(l.timer); l.timer = setTimeout(() => dropLink(device), 45000) }
  }
  try {
    const device = await btDevice(false, job)
    await inLane(`bt:${device.id}`, async () => {
      try {
        await send(device)
      } catch (e) {
        // A dropped connection: reconnect the SAME remembered printer once; never re-open the chooser
        if (e?.name === 'NetworkError' || links.has(device.id)) { dropLink(device); await send(device) } else throw e
      }
    })
  } catch (e) { throw friendly(e) }
}
