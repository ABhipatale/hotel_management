import { MessageCircle, Printer } from 'lucide-react'
import { buildReceipt, printBluetooth, printUsb } from '../lib/escpos'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Button } from './ui'

const m = (n) => Number(n).toFixed(2)

/** Company-branded receipt. Width follows this company's saved printer setting (58mm / 80mm). */
export default function Receipt({ data, phone }) {
  const toast = useToast()
  const { hasFeature } = useAuth()
  const { bill, company, printer, table, order_no, waiter } = data
  const width = printer?.paper_width === '58mm' ? '58mm' : '80mm'
  const conn = printer?.connection || 'browser'
  const canEscpos = hasFeature('thermal') && printer?.use_escpos && (conn === 'usb' || conn === 'bluetooth')

  const print = async () => {
    try {
      if (canEscpos) {
        const bytes = buildReceipt(data)
        conn === 'usb' ? await printUsb(bytes) : await printBluetooth(bytes)
        toast.success('Sent to printer')
      } else {
        window.print()
      }
    } catch (e) {
      toast.error(e.message || 'Printing failed — falling back to browser print')
      if (e.name !== 'NotFoundError') setTimeout(() => window.print(), 300)
    }
  }

  const whatsapp = () => {
    const lines = bill.items.map((i) => `${i.quantity} x ${i.name} — ₹${m(i.total)}`).join('\n')
    const msg = `*${company.name}*\nBill ${bill.bill_no}\n${lines}\n\nTotal: *₹${m(bill.grand_total)}*\n${company.bill_footer || 'Thank you!'}`
    const num = (phone || '').replace(/\D/g, '')
    window.open(`https://wa.me/${num ? (num.length === 10 ? '91' + num : num) : ''}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
  }

  return (
    <div>
      <div id="receipt" className="mx-auto bg-white p-3 font-mono text-[12px] leading-snug text-black shadow-sm ring-1 ring-line" style={{ width }}>
        <div className="text-center">
          {printer?.show_logo !== false && company.logo_url && <img src={company.logo_url} alt="" className="mx-auto mb-1 h-12 object-contain grayscale" />}
          <div className="text-sm font-bold">{company.name}</div>
          {company.bill_header && <div>{company.bill_header}</div>}
          {company.address && <div>{company.address}</div>}
          {company.phone && <div>Ph: {company.phone}</div>}
          {company.gst_number && <div>GSTIN: {company.gst_number}</div>}
        </div>
        <hr className="my-1.5 border-dashed border-black" />
        <div className="flex justify-between"><span>Bill: {bill.bill_no}</span><span>{new Date(bill.created_at).toLocaleDateString('en-IN')}</span></div>
        <div className="flex justify-between"><span>Order: {order_no}</span>{table && <span>Table {table}</span>}</div>
        {waiter && <div>Waiter: {waiter}</div>}
        <hr className="my-1.5 border-dashed border-black" />
        {bill.items.map((i) => (
          <div key={i.id} className="mb-0.5"><div>{i.quantity} x {i.name}</div><div className="flex justify-between"><span className="pl-3">@{m(i.price)}{Number(i.discount) ? ` (-${m(i.discount)})` : ''}{Number(i.tax) ? ` +tax ${m(i.tax)}` : ''}</span><span>{m(i.total)}</span></div></div>
        ))}
        <hr className="my-1.5 border-dashed border-black" />
        <div className="flex justify-between"><span>Subtotal</span><span>{m(bill.subtotal)}</span></div>
        {Number(bill.discount) > 0 && <div className="flex justify-between"><span>Discount</span><span>-{m(bill.discount)}</span></div>}
        <div className="flex justify-between"><span>GST</span><span>{m(bill.tax)}</span></div>
        <div className="mt-1 flex justify-between text-sm font-bold"><span>TOTAL</span><span>₹{m(bill.grand_total)}</span></div>
        {bill.payments?.map((p) => <div key={p.id} className="flex justify-between"><span>Paid ({p.method})</span><span>{m(p.amount)}</span></div>)}
        <hr className="my-1.5 border-dashed border-black" />
        <div className="text-center">{company.bill_footer || 'Thank you! Visit again.'}</div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={print}><Printer className="h-4 w-4" /> Print{canEscpos ? ` (${conn})` : ''}</Button>
        <Button variant="secondary" className="flex-1" onClick={whatsapp}><MessageCircle className="h-4 w-4" /> WhatsApp</Button>
      </div>
      {conn === 'network' && <p className="mt-2 text-center text-xs text-muted">Network printers use the browser print dialog from this device.</p>}
    </div>
  )
}
