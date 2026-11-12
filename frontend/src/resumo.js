// Transforma a linha de uma pessoa do /api/resumo em listas prontas para a tela e para o PDF.

export const PDF_SECTIONS = [
  { key: 'concluidos', label: 'Concluídos' },
  { key: 'pendentes', label: 'Pendentes' },
  { key: 'comentarios', label: 'Comentários' },
  { key: 'atividade', label: 'Outras atividades' },
]

export const STATUS_GROUPS = [
  { key: 'atrasado', label: 'Atrasados' },
  { key: 'hoje', label: 'Vencem no dia' },
  { key: 'andamento', label: 'Em andamento' },
  { key: 'prazo', label: 'No prazo' },
  { key: null, label: 'Sem prazo' },
]

const byHour = (a, b) => (a.hora || '').localeCompare(b.hora || '')

export function buildFeeds(row) {
  const concluidos = [
    ...row.itensConcluidos.map((i) => ({
      hora: i.hora, tipo: 'Item', titulo: i.texto, card: i.card,
      nota: [i.checklist, i.concluidoPor && `marcado por ${i.concluidoPor}`].filter(Boolean).join(' · ') || null,
    })),
    ...row.cardsConcluidos.map((c) => ({ hora: c.hora, tipo: 'Card', titulo: c.card.nome, card: { ...c.card, nome: '' }, nota: c.via })),
  ].sort(byHour)

  const pendentes = [
    ...row.itensPendentes.map((i) => ({
      tipo: 'Item', titulo: i.texto, card: i.card, status: i.status, prazo: i.dataFim, nota: i.checklist || null,
    })),
    ...row.cardsPendentes.map((c) => ({
      tipo: 'Card', titulo: c.card.nome, card: { ...c.card, nome: '' }, status: c.status, prazo: c.due,
    })),
  ]

  const comentarios = row.comentarios.map((c) => ({ hora: c.hora, titulo: c.card.nome, citacao: c.texto, card: { ...c.card, nome: '' } }))

  const atividade = [
    ...row.cardsCriados.map((c) => ({ hora: c.hora, tipo: 'Criou', titulo: c.card.nome, card: { ...c.card, nome: '' }, nota: c.lista ? `na lista ${c.lista}` : null })),
    ...row.movimentacoes.map((m) => ({ hora: m.hora, tipo: 'Moveu', titulo: m.card.nome, card: { ...m.card, nome: '' }, nota: `${m.de || '?'} → ${m.para || '?'}` })),
  ].sort(byHour)

  return { concluidos, pendentes, comentarios, atividade }
}

export function pendingGroups(items) {
  return STATUS_GROUPS
    .map((g) => ({ ...g, key: g.key ?? 'sem', items: items.filter((i) => (i.status ?? null) === g.key) }))
    .filter((g) => g.items.length)
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.prazo || '9').localeCompare(b.prazo || '9')) }))
}
