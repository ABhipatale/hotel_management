// Which language the printed / shared bill uses on THIS device. 'auto' = follow the shop's / app's language.
const KEY = 'hms.billlang'

export const billLang = {
  /** 'en' | 'mr' | 'auto' */
  get: () => { try { const v = localStorage.getItem(KEY); return v === 'en' || v === 'mr' ? v : 'auto' } catch { return 'auto' } },
  set: (v) => { try { v === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v) } catch { /* private mode */ } },
}
