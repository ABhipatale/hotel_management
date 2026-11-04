// Minimal ESC/POS encoder + Web USB / Web Bluetooth transport. Chromium-based browsers only.
// Network printers cannot be reached directly from a browser (no raw TCP) — they use the browser-print fallback
// or a local print agent. Settings are still stored per company/branch.
const ESC = 0x1b
const GS = 0x1d

const enc = new TextEncoder()

export function buildReceipt({ bill, company, table, order_no, waiter, printer }) {
  const cols = printer?.paper_width === '58mm' ? 32 : 48
  const out = []
  const push = (...b) => out.push(...b)
  const text = (s) => out.push(...enc.encode(s.replace(/[^\x20-\x7E\n]/g, '?')))
  const line = (s = '') => text(s + '\n')
  const rule = () => line('-'.repeat(cols))
  const two = (l, r) => line(l.slice(0, cols - r.length - 1).padEnd(cols - r.length) + r)
  const money = (n) => Number(n).toFixed(2)

  push(ESC, 0x40) // init
  push(ESC, 0x61, 1) // center
  push(ESC, 0x45, 1)
  line(company.name)
  push(ESC, 0x45, 0)
  if (company.bill_header) line(company.bill_header)
  if (company.address) line(company.address)
  if (company.phone) line(`Ph: ${company.phone}`)
  if (company.gst_number) line(`GSTIN: ${company.gst_number}`)
  push(ESC, 0x61, 0)
  rule()
  two(`Bill: ${bill.bill_no}`, new Date(bill.created_at).toLocaleDateString('en-IN'))
  two(`Order: ${order_no || ''}`, table ? `Table ${table}` : '')
  if (waiter) line(`Waiter: ${waiter}`)
  rule()
  bill.items.forEach((i) => {
    line(`${i.quantity} x ${i.name}`.slice(0, cols))
    two('', money(i.price * i.quantity - i.discount + Number(i.tax)))
  })
  rule()
  two('Subtotal', money(bill.subtotal))
  if (Number(bill.discount)) two('Discount', `-${money(bill.discount)}`)
  two('Tax (GST)', money(bill.tax))
  push(ESC, 0x45, 1)
  push(GS, 0x21, 0x01)
  two('TOTAL', money(bill.grand_total))
  push(GS, 0x21, 0x00)
  push(ESC, 0x45, 0)
  if (bill.payments?.length) {
    rule()
    bill.payments.forEach((p) => two(`Paid (${p.method})`, money(p.amount)))
  }
  rule()
  push(ESC, 0x61, 1)
  line(company.bill_footer || 'Thank you! Visit again.')
  line('\n\n\n')
  push(GS, 0x56, 0x42, 0x00) // partial cut
  return new Uint8Array(out)
}

async function chunked(write, bytes, size) {
  for (let i = 0; i < bytes.length; i += size) await write(bytes.slice(i, i + size))
}

export async function printUsb(bytes) {
  if (!navigator.usb) throw new Error('WebUSB is not supported in this browser. Use Chrome/Edge or browser print.')
  const device = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }] })
  await device.open()
  if (!device.configuration) await device.selectConfiguration(1)
  const iface = device.configuration.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 7))
  if (!iface) throw new Error('No printer interface found on this device')
  await device.claimInterface(iface.interfaceNumber)
  const ep = iface.alternates[0].endpoints.find((e) => e.direction === 'out')
  await chunked((c) => device.transferOut(ep.endpointNumber, c), bytes, 64)
  await device.close()
}

export async function printBluetooth(bytes) {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is not supported in this browser. Use Chrome/Edge on Android/desktop or browser print.')
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'],
  })
  const server = await device.gatt.connect()
  const services = await server.getPrimaryServices()
  for (const s of services) {
    const chars = await s.getCharacteristics()
    const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse)
    if (w) {
      await chunked((c) => (w.properties.writeWithoutResponse ? w.writeValueWithoutResponse(c) : w.writeValue(c)), bytes, 100)
      server.disconnect()
      return
    }
  }
  throw new Error('No writable printer characteristic found')
}
