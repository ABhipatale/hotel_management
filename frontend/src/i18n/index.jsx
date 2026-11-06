import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Tiny i18n: English text IS the key.  t('Place order')  ->  'ऑर्डर द्या' in Marathi, falls back to the English text.
 * Variables: t('Table {n}', { n: 4 }).  Dictionaries live in ./locales/*.js, each exporting { hi: {...}, mr: {...} }.
 */
export const LANGS = [
  { code: 'en', short: 'EN', label: 'English' },
  { code: 'hi', short: 'हिं', label: 'हिन्दी' },
  { code: 'mr', short: 'मरा', label: 'मराठी' },
]

const dict = { hi: {}, mr: {} }
const modules = import.meta.glob('./locales/*.js', { eager: true })
Object.values(modules).forEach((m) => {
  Object.assign(dict.hi, m.default?.hi || {})
  Object.assign(dict.mr, m.default?.mr || {})
})

const KEY = 'hms.lang'
const hasChoice = () => { try { return LANGS.some((l) => l.code === localStorage.getItem(KEY)) } catch { return false } }
const read = () => { try { const v = localStorage.getItem(KEY); return LANGS.some((l) => l.code === v) ? v : 'en' } catch { return 'en' } }

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s)

// Module-level copy of the language so non-React code (API error messages, toasts) can translate too
let current = read()
export const tr = (s, vars) => fill((current !== 'en' && dict[current]?.[s]) || s, vars)

const Ctx = createContext({ lang: 'en', setLang: () => {}, setDefault: () => {}, t: (s, v) => fill(s, v) })

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(read)

  useEffect(() => { current = lang; document.documentElement.lang = lang }, [lang])

  const setLang = useCallback((l) => {
    setLangState(l)
    try { localStorage.setItem(KEY, l) } catch { /* private mode */ }
  }, [])

  // The company's default language (set by the platform admin) applies only until the user picks their own
  const setDefault = useCallback((l) => {
    if (LANGS.some((x) => x.code === l) && !hasChoice()) { current = l; setLangState(l) }
  }, [])

  const value = useMemo(() => ({
    lang,
    setLang,
    setDefault,
    t: (s, vars) => fill((lang !== 'en' && dict[lang]?.[s]) || s, vars),
  }), [lang, setLang, setDefault])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx)
export const useT = () => useContext(Ctx).t
