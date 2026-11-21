// Which language the printed / shared bill uses on THIS device. 'auto' = follow the shop's / app's language.
const KEY = 'hms.billlang'

export const billLang = {
  /** 'en' | 'mr' | 'auto' */
  get: () => { try { const v = localStorage.getItem(KEY); return v === 'en' || v === 'mr' ? v : 'auto' } catch { return 'auto' } },
  set: (v) => { try { v === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v) } catch { /* private mode */ } },
}

// Paper width of THE PRINTER ON THIS DEVICE. The hotel's printer setting is one value for everybody, but a hotel can have a 58 mm and an
// 80 mm printer on different phones: a bill laid out for the wrong width wraps and looks broken. 'auto' = use the hotel's setting.
export const devicePaper = {
  get: () => { try { const v = localStorage.getItem('hms.paper'); return v === '58mm' || v === '80mm' ? v : 'auto' } catch { return 'auto' } },
  set: (v) => { try { v === 'auto' ? localStorage.removeItem('hms.paper') : localStorage.setItem('hms.paper', v) } catch { /* private mode */ } },
}

// How an ENGLISH bill is sent to a thermal printer on THIS device: 'picture' (neat layout, slower) or 'text' (the printer's own letters: fastest).
// Marathi and any bill with non-English letters is always a picture.
export const billStyle = {
  get: () => { try { return localStorage.getItem('hms.billstyle') === 'text' ? 'text' : 'picture' } catch { return 'picture' } },
  set: (v) => { try { localStorage.setItem('hms.billstyle', v === 'text' ? 'text' : 'picture') } catch { /* private mode */ } },
}

// Which language the KITCHEN SLIP (KOT) prints in on THIS device. 'auto' = follow the app's language (so a Marathi screen prints a Marathi slip).
export const kotLang = {
  /** 'en' | 'mr' | 'auto' */
  get: () => { try { const v = localStorage.getItem('hms.kotlang'); return v === 'en' || v === 'mr' ? v : 'auto' } catch { return 'auto' } },
  set: (v) => { try { v === 'auto' ? localStorage.removeItem('hms.kotlang') : localStorage.setItem('hms.kotlang', v) } catch { /* private mode */ } },
  /** The language to print with: this device's choice, else the app language that was passed in. */
  resolve(appLang) { const v = this.get(); return v === 'auto' ? appLang : v },
}
