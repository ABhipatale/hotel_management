import { api } from './api'

let scriptPromise
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve()
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = resolve
    s.onerror = () => { scriptPromise = null; reject(new Error('Could not load the payment window. Check your internet connection.')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * Buys / renews a subscription.
 * Resolves with the subscription when paid, or null when the customer closed the payment window.
 * Throws on errors (message ready to show).
 */
export async function purchase(cycle) {
  const { data: co } = await api.post('/subscription/checkout', { billing_cycle: cycle })

  if (co.mode === 'simulated') {
    const { data } = await api.post('/subscription/confirm', { order_id: co.order_id })
    return data
  }

  await loadCheckout()
  const result = await new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      key: co.key_id,
      order_id: co.order_id,
      amount: co.amount_paise,
      currency: co.currency,
      name: co.name,
      description: co.description,
      prefill: co.prefill,
      theme: { color: '#17645F' },
      handler: (resp) => resolve(resp),
      modal: { ondismiss: () => resolve(null) },
    })
    rz.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'Payment failed. You were not charged.')))
    rz.open()
  })
  if (!result) return null

  const { data } = await api.post('/subscription/confirm', {
    order_id: result.razorpay_order_id,
    razorpay_payment_id: result.razorpay_payment_id,
    razorpay_signature: result.razorpay_signature,
  })
  return data
}
