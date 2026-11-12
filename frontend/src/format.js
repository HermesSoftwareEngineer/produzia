const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' })
const LONG = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
const SHORT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

export function parseDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIso(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(iso, n) {
  const d = parseDay(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

export const weekday = (iso) => WEEKDAY.format(parseDay(iso))
export const longDate = (iso) => LONG.format(parseDay(iso))
export const shortDate = (iso) => (iso ? SHORT.format(parseDay(iso.slice(0, 10))) : '')

export function shortDateTime(iso) {
  if (!iso) return ''
  return SHORT.format(new Date(iso))
}

export const fmt = (n) => (n ?? 0).toLocaleString('pt-BR')

export function delta(current, previous) {
  if (!previous) return current ? null : 0
  return Math.round(((current - previous) / previous) * 100)
}
