import { Languages } from 'lucide-react'
import { LANGS, useI18n } from '../i18n'

/** English / हिन्दी / मराठी switch. tone="dark" for use on the teal header, "light" on white / ivory. */
export default function LangSwitch({ tone = 'light', className = '' }) {
  const { lang, setLang } = useI18n()
  const dark = tone === 'dark'
  return (
    <div role="group" aria-label="Language" className={`inline-flex items-center gap-1 rounded-2xl p-1 ${dark ? 'bg-white/15' : 'bg-canvas ring-1 ring-line'} ${className}`}>
      <Languages className={`mx-1.5 h-4 w-4 shrink-0 ${dark ? 'text-white/70' : 'text-muted'}`} />
      {LANGS.map((l) => {
        const on = l.code === lang
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => setLang(l.code)}
            aria-pressed={on}
            title={l.label}
            className={`min-h-9 rounded-xl px-3 text-sm font-bold transition active:scale-95 ${on ? (dark ? 'bg-white text-brand' : 'bg-brand text-white') : (dark ? 'text-white/80' : 'text-ink')}`}
          >{l.short}</button>
        )
      })}
    </div>
  )
}
