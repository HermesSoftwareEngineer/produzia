// Regras e contas do cronograma (Gantt), usadas na tela e no PDF.
// As datas vêm como AAAA-MM-DD e viram "número do dia" (dias desde 1970, em UTC),
// para que somar dias nunca esbarre em horário de verão.

const DAY_MS = 86400000

export const dayNum = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
export const dateOf = (n) => new Date(n * DAY_MS)
export const isoOf = (n) => dateOf(n).toISOString().slice(0, 10)

const MONTH_LONG = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
const WEEKDAY_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
export const monthShort = (n) => MONTH_SHORT.format(dateOf(n)).replace('.', '')

// 05/11, ou 05/11/2027 quando o ano não é o de hoje.
export function dayLabel(iso, hoje) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return hoje && hoje.slice(0, 4) === y ? `${d}/${m}` : `${d}/${m}/${y}`
}

export const ZOOMS = [
  { key: 'dia', label: 'Dia', px: 30 },
  { key: 'semana', label: 'Semana', px: 11 },
  { key: 'mes', label: 'Mês', px: 3.5 },
]

export const STATUS = {
  concluido: 'Concluído',
  atrasado: 'Atrasado',
  andamento: 'Em andamento',
  futuro: 'Futuro',
  semdata: 'Sem datas',
}

// Primeiro e último dia (números) mostrados na linha do tempo.
export function timelineRange(intervalo, hoje, zoom, minWidth = 900) {
  const today = dayNum(hoje)
  let start = Math.min(intervalo ? dayNum(intervalo.inicio) : today, today)
  let end = Math.max(intervalo ? dayNum(intervalo.fim) : today, today)
  const px = ZOOMS.find((z) => z.key === zoom).px
  if (zoom === 'dia') {
    start -= 3
    end += 7
  } else if (zoom === 'semana') {
    start -= ((dateOf(start).getUTCDay() + 6) % 7) + 7 // segunda-feira da semana anterior
    end += 14
  } else {
    const s = dateOf(start)
    start = Math.round(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1) / DAY_MS)
    const e = dateOf(end)
    end = Math.round(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 2, 0) / DAY_MS)
  }
  end = Math.max(end, start + Math.ceil(minWidth / px))
  return { start, end, days: end - start + 1, px }
}

// Agrupa dias consecutivos com a mesma chave em faixas { key, label, from, len }.
function segments(start, end, keyOf, labelOf) {
  const out = []
  for (let n = start; n <= end; n += 1) {
    const key = keyOf(n)
    const last = out[out.length - 1]
    if (last && last.key === key) last.len += 1
    else out.push({ key, label: labelOf(n), from: n - start, len: 1 })
  }
  return out
}

const monthKey = (n) => isoOf(n).slice(0, 7)

// Cabeçalho em duas faixas, conforme o zoom.
export function scaleTiers({ start, end }, zoom) {
  if (zoom === 'dia') {
    const top = segments(start, end, monthKey, (n) => `${cap(MONTH_LONG.format(dateOf(n)))} ${dateOf(n).getUTCFullYear()}`)
    const bottom = []
    for (let n = start; n <= end; n += 1) {
      const wd = dateOf(n).getUTCDay()
      bottom.push({ key: n, label: String(dateOf(n).getUTCDate()), sub: WEEKDAY_LETTER[wd], from: n - start, len: 1, weekend: wd === 0 || wd === 6 })
    }
    return { top, bottom }
  }
  if (zoom === 'semana') {
    const top = segments(start, end, monthKey, (n) => `${monthShort(n)} ${dateOf(n).getUTCFullYear()}`)
    const weekStart = (n) => n - ((dateOf(n).getUTCDay() + 6) % 7)
    const bottom = segments(start, end, weekStart, (n) => {
      const d = dateOf(weekStart(n))
      return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    })
    return { top, bottom }
  }
  const top = segments(start, end, (n) => dateOf(n).getUTCFullYear(), (n) => String(dateOf(n).getUTCFullYear()))
  const bottom = segments(start, end, monthKey, monthShort)
  return { top, bottom }
}

// Dias de fim de semana dentro do intervalo (índices a partir do início).
export function weekendIndexes({ start, end }) {
  const out = []
  for (let n = start; n <= end; n += 1) {
    const wd = dateOf(n).getUTCDay()
    if (wd === 0 || wd === 6) out.push(n - start)
  }
  return out
}

// Aplica os filtros e devolve os cards visíveis, cada um com `visiveis` (itens que sobram).
export function filterCards(cards, { pessoa, ocultarConcluidos, soComDatas }) {
  const out = []
  for (const card of cards) {
    let itens = card.itens
    if (pessoa) {
      const membro = card.membros.includes(pessoa)
      if (!membro) itens = itens.filter((i) => i.responsavel === pessoa)
      if (!membro && !itens.length) continue
    }
    if (ocultarConcluidos) {
      if (card.concluido) continue
      itens = itens.filter((i) => !i.feito)
    }
    if (soComDatas) {
      if (!card.inicio) continue
      itens = itens.filter((i) => i.inicio)
    }
    out.push({ ...card, visiveis: itens })
  }
  return out
}

// Agrupa os cards visíveis pelas listas, na ordem do quadro.
export function groupByList(listas, cards) {
  const byList = new Map(listas.map((l) => [l.id, { lista: l, cards: [] }]))
  const orphan = { lista: { id: '_outra', nome: 'Outra lista', concluida: false }, cards: [] }
  for (const card of cards) (byList.get(card.listaId) || orphan).cards.push(card)
  return [...byList.values(), orphan].filter((g) => g.cards.length)
}

// Menor início e maior fim entre os cards e itens visíveis.
export function visibleRange(cards) {
  let min = null
  let max = null
  for (const c of cards) {
    for (const x of [c, ...c.visiveis]) {
      if (!x.inicio) continue
      if (!min || x.inicio < min) min = x.inicio
      if (!max || x.fim > max) max = x.fim
    }
  }
  return min ? { inicio: min, fim: max } : null
}

export function progress(card) {
  if (!card.itensTotal) return card.concluido ? 100 : 0
  return Math.round((100 * card.itensFeitos) / card.itensTotal)
}
