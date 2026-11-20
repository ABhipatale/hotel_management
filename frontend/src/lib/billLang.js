// Which language the printed / shared bill uses on THIS device. 'auto' = follow the shop's / app's language.
const KEY = 'hms.billlang'

export const billLang = {
  /** 'en' | 'mr' | 'auto' */
  get: () => { try { const v = localStorage.getItem(KEY); return v === 'en' || v === 'mr' ? v : 'auto' } catch { return 'auto' } },
  set: (v) => { try { v === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v) } catch { /* private mode */ } },
}

// How an ENGLISH bill is sent to a thermal printer on THIS device: 'picture' (neat layout, slower) or 'text' (the printer's own letters: fastest).
// Marathi and any bill with non-English letters is always a picture.
export const billStyle = {
  get: () => { try { return localStorage.getItem('hms.billstyle') === 'text' ? 'text' : 'picture' } catch { return 'picture' } },
  set: (v) => { try { localStorage.setItem('hms.billstyle', v === 'text' ? 'text' : 'picture') } catch { /* private mode */ } },
}
