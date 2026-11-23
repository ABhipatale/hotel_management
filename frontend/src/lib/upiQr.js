// UPI payment QR on the bill: the customer scans it with PhonePe / GPay / Paytm and pays the exact bill amount.
// Shown only on a bill that is not paid yet, and only when the hotel has saved a UPI ID in Settings.
import qrcode from 'qrcode-generator'

const GS = 0x1d

/** UPI IDs look like name@bank. Used for the Settings field and the backend rule. */
export const validUpi = (v) => /^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9.-]{1,}$/.test(String(v || '').trim())

/** upi://pay link with the bill's exact amount, or null when no QR should be shown. */
export function upiLink(company, bill) {
  const id = String(company?.upi_id || '').trim()
  if (!validUpi(id) || !bill || bill.status === 'paid' || bill.status === 'cancelled') return null
  const amount = Number(bill.grand_total)
  if (!(amount > 0)) return null
  const q = new URLSearchParams({ pa: id, pn: (company.upi_name || company.name || '').slice(0, 60), am: amount.toFixed(2), cu: 'INR', tn: `Bill ${bill.bill_no}` })
  return `upi://pay?${q.toString().replace(/\+/g, '%20').replace('%40', '@')}`
}

/** The QR as rows of booleans (true = dark module). */
export function qrMatrix(text) {
  const qr = qrcode(0, 'L')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)))
}

/** The QR centred in a picture exactly `width` dots wide, as ESC/POS raster bytes (works on every thermal printer, no native QR command needed). */
export function qrRaster(text, width, maxDots = 200) {
  const m = qrMatrix(text)
  const n = m.length
  const px = Math.max(2, Math.floor(Math.min(maxDots, width - 16) / (n + 8))) // dots per module, quiet zone of 4 modules each side
  const size = (n + 8) * px
  const rowBytes = width / 8
  const left = Math.floor((width - size) / 2)
  const bytes = []
  const BAND = 48 // small pieces: a printer with a small buffer never has to swallow the whole QR in one command
  for (let top = 0; top < size; top += BAND) {
    const h = Math.min(BAND, size - top)
    bytes.push(GS, 0x76, 0x30, 0, rowBytes & 255, rowBytes >> 8, h & 255, h >> 8)
    for (let y = top; y < top + h; y++) {
      const mr = Math.floor(y / px) - 4
      for (let bx = 0; bx < rowBytes; bx++) {
        let b = 0
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit - left
          const mc = Math.floor(x / px) - 4
          if (x >= 0 && x < size && mr >= 0 && mr < n && mc >= 0 && mc < n && m[mr][mc]) b |= 0x80 >> bit
        }
        bytes.push(b)
      }
    }
  }
  return bytes
}
