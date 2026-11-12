import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmt, longDate, shortDate, weekday } from './format.js'
import { pendingGroups } from './resumo.js'

const INK = [15, 23, 42]
const MUTED = [100, 116, 139]
const LINE = [226, 232, 240]
const BRAND = [15, 118, 110]
const BAD = [185, 28, 28]
const M = 14 // margem em mm

// As fontes padrao do PDF so cobrem Latin-1/cp1252: remove emojis e simbolos fora disso.
const CP1252_EXTRA = new Set('–—‘’“”•…€→'.split(''))
function clean(text) {
  if (!text) return ''
  return [...String(text)]
    .map((ch) => (ch === '→' ? '->' : ch))
    .filter((ch) => ch.charCodeAt(0) <= 255 || CP1252_EXTRA.has(ch))
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const cardLabel = (card) => clean([card.nome, card.quadro, card.lista].filter(Boolean).join(' · '))
const STATUS_ONE = { atrasado: 'Atrasado', hoje: 'Vence no dia', andamento: 'Em andamento', prazo: 'No prazo' }
const statusLabel = (s) => STATUS_ONE[s] || 'Sem prazo'

export function exportResumoPdf({ data, people, day, boardsLabel, sections, filtered }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  let y = M

  // Cabecalho
  doc.setFillColor(...BRAND)
  doc.roundedRect(M, y, 7, 7, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BRAND)
  doc.text('Produzia', M + 9.5, y + 5)
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, W - M, y + 5, { align: 'right' })
  y += 15

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...INK)
  doc.text('Resumo do dia', M, y)
  y += 7
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...INK)
  doc.text(clean(`${capitalize(weekday(day))}, ${longDate(day)}`), M, y)
  y += 5
  doc.setFontSize(8.5).setTextColor(...MUTED)
  const scope = doc.splitTextToSize(clean(`Quadros: ${boardsLabel}${filtered ? ' · lista de pessoas filtrada' : ''}`), W - 2 * M)
  doc.text(scope, M, y)
  y += scope.length * 4 + 4

  // Totais da equipe
  const t = data.totais
  const metrics = [
    [t.itensConcluidos, 'itens feitos'],
    [t.cardsConcluidos, 'cards concluídos'],
    [t.comentarios, 'comentários'],
    [t.itensPendentes, `itens pendentes${t.itensAtrasados ? ` (${t.itensAtrasados} atras.)` : ''}`],
    [t.cardsPendentes, `cards pendentes${t.cardsAtrasados ? ` (${t.cardsAtrasados} atras.)` : ''}`],
  ]
  const colW = (W - 2 * M) / metrics.length
  doc.setDrawColor(...LINE).setLineWidth(0.3)
  doc.line(M, y, W - M, y)
  metrics.forEach(([value, label], i) => {
    const x = M + i * colW
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...INK)
    doc.text(fmt(value), x, y + 9)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
    doc.text(clean(label), x, y + 14)
  })
  y += 19
  doc.line(M, y, W - M, y)
  y += 8

  const tableBase = {
    margin: { left: M, right: M, top: M + 4, bottom: M + 4 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', textColor: MUTED, fontSize: 7, lineWidth: { bottom: 0.3 }, lineColor: LINE },
    bodyStyles: { lineWidth: { bottom: 0.1 }, lineColor: LINE },
  }

  const ensureSpace = (needed) => {
    if (y + needed > doc.internal.pageSize.getHeight() - M - 6) {
      doc.addPage()
      y = M + 4
    }
  }

  const subtitle = (text) => {
    ensureSpace(14)
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED)
    doc.text(clean(text).toUpperCase(), M, y)
    y += 2
  }

  const table = (head, body, columnStyles, extra = {}) => {
    autoTable(doc, { ...tableBase, startY: y, head: [head], body, columnStyles, ...extra })
    y = doc.lastAutoTable.finalY + 6
  }

  people.forEach(({ pessoa, totais: pt, feeds }, index) => {
    const done = feeds.concluidos.length
    const pending = feeds.pendentes.length
    const late = pt.itensAtrasados + pt.cardsAtrasados
    ensureSpace(24)
    if (index > 0) y += 2

    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK)
    doc.text(clean(pessoa.nome), M, y)
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED)
    const summary = `${done} concluídos · ${pending} pendentes${late ? ` (${late} atrasados)` : ''} · ${pt.comentarios} comentários`
    doc.text(clean(summary), W - M, y, { align: 'right' })
    y += 2.5
    doc.setDrawColor(...INK).setLineWidth(0.4)
    doc.line(M, y, W - M, y)
    y += 5

    let wrote = false
    if (sections.concluidos && done) {
      subtitle(`Concluídos (${done})`)
      table(['Hora', 'Tipo', 'Descrição', 'Card · Quadro · Lista'],
        feeds.concluidos.map((e) => [e.hora, e.tipo, clean([e.titulo, e.nota].filter(Boolean).join('\n')), cardLabel(e.card)]),
        { 0: { cellWidth: 12, textColor: MUTED }, 1: { cellWidth: 12, textColor: MUTED }, 2: { cellWidth: 82 } })
      wrote = true
    }
    if (sections.pendentes && pending) {
      subtitle(`Pendentes (${pending})`)
      const rows = pendingGroups(feeds.pendentes).flatMap((g) => g.items.map((e) => [
        statusLabel(e.status), e.prazo ? shortDate(e.prazo) : '', e.tipo, clean(e.titulo), cardLabel(e.card),
      ]))
      table(['Situação', 'Prazo', 'Tipo', 'Descrição', 'Card · Quadro · Lista'], rows,
        { 0: { cellWidth: 22 }, 1: { cellWidth: 13, textColor: MUTED }, 2: { cellWidth: 11, textColor: MUTED }, 3: { cellWidth: 70 } },
        { didParseCell: (c) => { if (c.section === 'body' && c.column.index === 0 && c.cell.raw === 'Atrasado') c.cell.styles.textColor = BAD } })
      wrote = true
    }
    if (sections.comentarios && feeds.comentarios.length) {
      subtitle(`Comentários (${feeds.comentarios.length})`)
      table(['Hora', 'Card · Quadro · Lista', 'Comentário'],
        feeds.comentarios.map((e) => [e.hora, cardLabel({ ...e.card, nome: e.titulo }), clean(e.citacao)]),
        { 0: { cellWidth: 12, textColor: MUTED }, 1: { cellWidth: 60 } })
      wrote = true
    }
    if (sections.atividade && feeds.atividade.length) {
      subtitle(`Outras atividades (${feeds.atividade.length})`)
      table(['Hora', 'Ação', 'Card', 'Detalhe'],
        feeds.atividade.map((e) => [e.hora, e.tipo, cardLabel({ ...e.card, nome: e.titulo }), clean(e.nota)]),
        { 0: { cellWidth: 12, textColor: MUTED }, 1: { cellWidth: 14, textColor: MUTED }, 2: { cellWidth: 90 } })
      wrote = true
    }
    if (!wrote) {
      doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(...MUTED)
      doc.text('Sem registros nas seções escolhidas.', M, y)
      y += 7
    }
  })

  if (!people.length) {
    doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(...MUTED)
    doc.text('Nenhuma pessoa com dados para os filtros escolhidos.', M, y)
  }

  // Rodape com paginacao
  const pages = doc.getNumberOfPages()
  const H = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
    doc.text(clean(`Resumo do dia · ${longDate(day)}`), M, H - M + 4)
    doc.text(`${i} / ${pages}`, W - M, H - M + 4, { align: 'right' })
  }

  doc.save(`produzia-resumo-${day}.pdf`)
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
