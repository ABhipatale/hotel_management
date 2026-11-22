// The software's own line printed at the very end of EVERY bill: fast text, neat picture and browser print, 58 mm and 80 mm.
// Change the words here only. Plain English letters on purpose: the fast text bill uses the printer's own font.
export const BILL_CREDIT = ['Powered by ABNEXA', 'www.abill.abnexa.in', '+91 9689030301']

/**
 * The credit as lines: as many parts per line as fit, joined with `sep`; a part is never split
 * (so "+91 9689030301" stays on one line). `fits(text)` says whether a line fits the paper.
 */
export function creditLines(fits, sep = ' | ') {
  const out = []
  BILL_CREDIT.forEach((part) => {
    const last = out[out.length - 1]
    if (last && fits(`${last}${sep}${part}`)) out[out.length - 1] = `${last}${sep}${part}`
    else out.push(part)
  })
  return out
}
