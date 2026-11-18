import { useState } from 'react'
import { MessageCircle, Printer } from 'lucide-react'
import { buildReceipt, printBluetooth, printUsb, savedPrinter } from '../lib/escpos'
import { buildReceiptImage, needsImage, receiptFooter, receiptLabels, receiptName } from '../lib/receiptImage'
import { billLang } from '../lib/billLang'
import { dateIST, timeIST } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n'
import { Button } from './ui'

const m = (n) => Number(n).toFixed(2)

/**
 * Company-branded receipt. Width follows this company's saved printer setting (58mm / 80mm).
 * In Marathi (or when the bill holds non-English text) the thermal receipt is sent as a picture, because a plain
 * ESC/POS printer cannot print Devanagari; English bills stay as fast, crisp text.
 */
export default function Receipt({ data, phone }) {
  const toast = useToast()
  const { t, lang } = useI18n()
  const { hasFeature, company: shop } = useAuth()
  const { bill, company, printer, table, waiter } = data
  // Receipt language: Marathi when the shop's default language is Marathi or the app is in Marathi, unless this device
  // chose otherwise with the English / मराठी buttons below (remembered on this device).
  const chosen = billLang.get() // set in Settings → Bill language ('auto' = follow the shop / app)
  const rl = chosen !== 'auto' ? chosen : (shop?.default_language === 'mr' || lang === 'mr' ? 'mr' : 'en')
  const L = receiptLabels(rl)
  const gstOn = company.gst_enabled !== false
  const width = printer?.paper_width === '58mm' ? '58mm' : '80mm'

  // Direct print: a printer chosen once on this device is used on every Print tap (no system print dialog),
  // whatever the Connection dropdown says. Without a saved printer it falls back to the browser print dialog.
  const setConn = printer?.connection || 'browser'
  const conn = setConn === 'usb' || setConn === 'bluetooth' ? setConn
    : savedPrinter('bluetooth') && navigator.bluetooth ? 'bluetooth'
    : savedPrinter('usb') && navigator.usb ? 'usb' : 'browser'
  const canEscpos = hasFeature('thermal') && printer?.use_escpos !== false && (conn === 'usb' || conn === 'bluetooth')

  const print = async () => {
    if (!canEscpos) { window.print(); return }
    try {
      const picture = needsImage(data, rl)
      const bytes = picture ? await buildReceiptImage(data, rl) : buildReceipt(data)
      const opts = { delay: picture ? 12 : 0 }
      conn === 'usb' ? await printUsb(bytes, opts) : await printBluetooth(bytes, opts)
      toast.success(t('Sent to printer'))
    } catch (e) {
      // Never open the system print dialog behind the user's back: show why it failed instead.
      toast.error(e.message ? t(e.message) : t('Printing failed'))
    }
  }

  const whatsapp = () => {
    const lines = bill.items.map((i) => `${i.quantity} x ${receiptName(i, rl)} — ₹${m(i.total)}`).join('\n')
    const msg = `*${company.name}*\n${L.bill} ${bill.bill_no}\n${lines}\n\n${L.total}: *₹${m(bill.grand_total)}*\n${receiptFooter(company, rl)}`
    const num = (phone || '').replace(/\D/g, '')
    window.open(`https://wa.me/${num ? (num.length === 10 ? '91' + num : num) : ''}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
  }

  const d = new Date(bill.created_at)
  const qty = bill.items.reduce((n, i) => n + Number(i.quantity), 0)

  return (
    <div>
      {/* Only the receipt scrolls; Print / WhatsApp stay fixed below it, however long the bill is */}
      <div id="receipt-scroll" className="max-h-[max(7rem,calc(88dvh-15.5rem))] overflow-y-auto overscroll-contain rounded-lg">
      <div id="receipt" className="mx-auto bg-white p-3 font-mono text-[12px] leading-snug text-black shadow-sm ring-1 ring-line" style={{ width, maxWidth: '100%' }}>
        <div className="text-center">
          {printer?.show_logo !== false && company.logo_url && <img src={company.logo_url} alt="" className="mx-auto mb-1 h-12 object-contain grayscale" />}
          <div className="text-lg font-extrabold leading-tight tracking-wide">{company.name}</div>
          {company.bill_header && <div>{company.bill_header}</div>}
          {company.address && <div>{company.address}</div>}
          {company.phone && <div>{L.phone}: {company.phone}</div>}
          {gstOn && company.gst_number && <div>{L.gstin}: {company.gst_number}</div>}
        </div>
        <hr className="my-1.5 border-t-2 border-double border-black" />
        <div className="flex flex-wrap justify-between gap-x-2"><span className="break-all">{L.bill}: {bill.bill_no}</span><span>{dateIST(d)} {timeIST(d)}</span></div>
        {table && <div className="flex justify-between gap-x-2"><span>{`${L.table}: ${table}`}</span></div>}
        <hr className="my-1.5 border-dashed border-black" />
        <div className="flex gap-1 font-bold"><span className="flex-1">{L.item}</span><span className="w-8 text-right">{L.qty}</span><span className="w-16 text-right">{L.amt}</span></div>
        <hr className="my-1 border-dashed border-black" />
        {bill.items.map((i) => (
          <div key={i.id} className="flex gap-1"><span className="flex-1">{receiptName(i, rl)}</span><span className="w-8 text-right">{i.quantity}</span><span className="w-16 text-right">{m(i.total)}</span></div>
        ))}
        <hr className="my-1 border-dashed border-black" />
        <div>{L.items}: {bill.items.length}   {L.totalQty}: {qty}</div>
        <hr className="my-1 border-dashed border-black" />
        <div className="flex justify-between"><span>{L.subtotal}</span><span>{m(bill.subtotal)}</span></div>
        {Number(bill.discount) > 0 && <div className="flex justify-between"><span>{L.discount}</span><span>-{m(bill.discount)}</span></div>}
        {gstOn && Number(bill.tax) > 0 && <div className="flex justify-between"><span>{L.gst}</span><span>{m(bill.tax)}</span></div>}
        <hr className="my-1.5 border-t-2 border-double border-black" />
        <div className="flex justify-between text-base font-extrabold"><span>{L.total}</span><span>₹{m(bill.grand_total)}</span></div>
        <hr className="my-1.5 border-t-2 border-double border-black" />
        {bill.payments?.map((p) => <div key={p.id} className="flex justify-between"><span>{L.paid} ({L[p.method] || p.method})</span><span>{m(p.amount)}</span></div>)}
        <div className="mt-2 text-center font-bold">{receiptFooter(company, rl)}</div>
      </div>
      </div>

      {/* Buttons wrap onto two rows on very narrow phones instead of overflowing the sheet */}
      <div className="mt-3 flex flex-wrap gap-2.5">
        <Button className="min-w-[8.5rem] flex-1" onClick={print}><Printer className="h-4 w-4" /> {t('Print')}</Button>
        <Button variant="secondary" className="min-w-[8.5rem] flex-1" onClick={whatsapp}><MessageCircle className="h-4 w-4" /> WhatsApp</Button>
      </div>
      {conn === 'network' && <p className="mt-2 text-center text-xs text-muted">{t('Network printers use the browser print dialog from this device.')}</p>}
    </div>
  )
}
