/**
 * Which name of a dish is the big one. In Marathi the Marathi name leads and the English name is the small line;
 * in every other language the English name leads and the Marathi name (if any) is the small line.
 */
/** Category name in the app's language only: Marathi app -> Marathi name (falls back to English), everything else -> English. */
export const catName = (c, lang) => (c ? (lang === 'mr' && c.name_mr ? c.name_mr : c.name) : '')

export function dishNames(item, lang) {
  if (lang === 'mr' && item.name_mr) return { main: item.name_mr, sub: item.name }
  return { main: item.name, sub: item.name_mr || null }
}
