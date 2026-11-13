// Datas e agrupamento do calendário (/api/calendario). Semana começa na segunda-feira.
import { addDays, parseDay, toIso } from './format.js'

export const VIEWS = [
  { key: 'mes', label: 'Mês' },
  { key: 'semana', label: 'Semana' },
  { key: 'dia', label: 'Dia' },
]

export const TYPES = [
  { key: 'ambos', label: 'Ambos' },
  { key: 'item', label: 'Itens' },
  { key: 'card', label: 'Cards' },
]

export const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

const MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long' })
const DAY_LONG = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
const DAY_LONG_YEAR = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

const STATUS_ORDER = { atrasado: 0, hoje: 1, pendente: 2, concluido: 3 }

export function startOfWeek(iso) {
  const d = parseDay(iso)
  return addDays(iso, -((d.getDay() + 6) % 7))
}

export function startOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`
}

export function addMonths(iso, n) {
  const d = parseDay(startOfMonth(iso))
  d.setMonth(d.getMonth() + n)
  return toIso(d)
}

/** Dias visíveis de cada vista (o mês ocupa semanas inteiras, de segunda a domingo). */
export function viewDays(view, iso) {
  let first = iso
  let count = 1
  if (view === 'semana') {
    first = startOfWeek(iso)
    count = 7
  } else if (view === 'mes') {
    first = startOfWeek(startOfMonth(iso))
    const last = addDays(addMonths(iso, 1), -1)
    const end = addDays(startOfWeek(last), 6)
    count = Math.round((parseDay(end) - parseDay(first)) / 86400000) + 1
  }
  return Array.from({ length: count }, (_, i) => addDays(first, i))
}

export function shiftDate(view, iso, dir) {
  if (view === 'mes') return addMonths(iso, dir)
  return addDays(iso, view === 'semana' ? 7 * dir : dir)
}

export function periodTitle(view, iso, todayIso) {
  const sameYear = iso.slice(0, 4) === todayIso.slice(0, 4)
  if (view === 'mes') return MONTH_YEAR.format(parseDay(iso))
  if (view === 'dia') return (sameYear ? DAY_LONG : DAY_LONG_YEAR).format(parseDay(iso))
  const a = startOfWeek(iso)
  const b = addDays(a, 6)
  const [da, db] = [parseDay(a), parseDay(b)]
  const year = sameYear && a.slice(0, 4) === b.slice(0, 4) ? '' : ` de ${db.getFullYear()}`
  if (a.slice(0, 7) === b.slice(0, 7)) return `${da.getDate()} – ${db.getDate()} de ${MONTH.format(db)}${year}`
  const yearA = a.slice(0, 4) !== b.slice(0, 4) ? ` de ${da.getFullYear()}` : ''
  return `${da.getDate()} de ${MONTH.format(da)}${yearA} – ${db.getDate()} de ${MONTH.format(db)}${year}`
}

export function filterTasks(tasks, { pessoa, tipo, mostrarConcluidas }) {
  return tasks.filter((t) => {
    if (tipo !== 'ambos' && t.tipo !== tipo) return false
    if (!mostrarConcluidas && t.concluido) return false
    if (pessoa === '_sem') return t.responsaveis.length === 0
    if (pessoa && !t.responsaveis.some((p) => p.id === pessoa)) return false
    return true
  })
}

export const sortTasks = (list) => [...list].sort((a, b) => (
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.titulo.localeCompare(b.titulo, 'pt-BR')
))

/** Agrupa as tarefas pelo dia do prazo (item feito sem nenhuma data: dia em que foi marcado). */
export function groupByDay(tasks) {
  const map = new Map()
  for (const t of tasks) {
    const day = t.prazo || (t.concluido ? t.concluidoEm : null)
    if (!day) continue
    if (!map.has(day)) map.set(day, [])
    map.get(day).push(t)
  }
  for (const [day, list] of map) map.set(day, sortTasks(list))
  return map
}

export function dayCounts(list = []) {
  const done = list.filter((t) => t.concluido).length
  const late = list.filter((t) => t.status === 'atrasado').length
  return { total: list.length, done, late }
}
