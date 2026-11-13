import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { STATUS, dateOf, dayNum, monthShort, visibleRange } from './gantt.js'
import { clean, drawIcon } from './pdf.js'

const INK = [15, 23, 42]
const MUTED = [100, 116, 139]
const LINE = [226, 232, 240]
const GRID = [238, 242, 247]
const BRAND = [15, 118, 110]
const TODAY = [217, 119, 6]
const TONES = {
  concluido: { fg: [13, 148, 136], bg: [230, 255, 250] },
  atrasado: { fg: [220, 38, 38], bg: [254, 242, 242] },
  andamento: { fg: [99, 102, 241], bg: [224, 231, 255] },
  futuro: { fg: [148, 163, 184], bg: [241, 245, 249] },
  semdata: { fg: [148, 163, 184], bg: [241, 245, 249] },
}
const M = 12 // margem em mm
const CHART = 6 // indice da coluna do cronograma

const fmtDay = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

// Marcas do eixo conforme a duracao: semanas, meses ou trimestres.
function axisTicks(start, end) {
  const span = end - start
  const ticks = []
  if (span <= 50) {
    let n = start + ((8 - dateOf(start).getUTCDay()) % 7) // proxima segunda
    for (; n <= end; n += 7) {
      const d = dateOf(n)
      ticks.push({ n, label: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` })
    }
    return ticks
  }
  const step = span <= 400 ? 1 : 3
  const s = dateOf(start)
  let y = s.getUTCFullYear()
  let m = s.getUTCMonth() + 1
  for (;;) {
    if (m > 11) { y += Math.floor(m / 12); m %= 12 }
    const n = Math.round(Date.UTC(y, m, 1) / 86400000)
    if (n > end) break
    if (m % step === 0) ticks.push({ n, label: m === 0 ? `${monthShort(n)} ${String(y).slice(2)}` : monthShort(n) })
    m += 1
  }
  return ticks
}

export function exportGanttPdf({ data, groups, people, filtros }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  let y = M

  // Cabecalho
  doc.setFillColor(...BRAND)
  doc.roundedRect(M, y, 7, 7, 1.5, 1.5, 'F')
  drawIcon(doc, 'bars', M + 1.3, y + 1.3, 4.4, [255, 255, 255])
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BRAND)
  doc.text('Produzia', M + 9.5, y + 5)
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, W - M, y + 5, { align: 'right' })
  y += 14

  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...INK)
  doc.text('Cronograma', M, y)
  const titleW = doc.getTextWidth('Cronograma')
  doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(...MUTED)
  doc.text(clean(`· ${data.quadro.nome}`), M + titleW + 2.5, y)
  y += 5.5
  const scope = [
    filtros.pessoa ? `Pessoa: ${filtros.pessoa}` : 'Todas as pessoas',
    filtros.ocultarConcluidos ? 'sem concluídos' : null,
    filtros.soComDatas ? 'só com datas' : null,
  ].filter(Boolean).join(' · ')
  doc.setFontSize(8.5).setTextColor(...MUTED)
  doc.text(clean(scope), M, y)

  // Legenda a direita
  let lx = W - M
  doc.setFontSize(7.5)
  for (const key of ['futuro', 'andamento', 'atrasado', 'concluido']) {
    const label = clean(STATUS[key])
    lx -= doc.getTextWidth(label)
    doc.setTextColor(...MUTED)
    doc.text(label, lx, y)
    lx -= 6
    doc.setFillColor(...TONES[key].fg)
    doc.roundedRect(lx, y - 2.4, 4.5, 2.4, 0.6, 0.6, 'F')
    lx -= 4
  }
  y += 6

  // Linhas da tabela, na ordem da tela (com todos os itens visiveis, mesmo recolhidos).
  const cards = groups.flatMap((g) => g.cards)
  const range = visibleRange(cards)
  const start = range ? dayNum(range.inicio) - 1 : 0
  const end = range ? dayNum(range.fim) + 1 : 1
  const today = dayNum(data.hoje)
  const ticks = range ? axisTicks(start, end) : []
  const names = (ids) => ids.map((id) => people.get(id)?.nome).filter(Boolean).join(', ')

  const body = []
  for (const { lista, cards: list } of groups) {
    list.forEach((card, i) => {
      body.push({
        kind: 'card', x: card, pct: card.itensTotal ? card.itensFeitos / card.itensTotal : (card.concluido ? 1 : 0),
        cells: [
          i === 0 ? clean(lista.nome) : '',
          clean(card.nome) + (card.itensTotal ? `  (${card.itensFeitos}/${card.itensTotal})` : ''),
          clean(names(card.membros)) || '—',
          fmtDay(card.inicio), fmtDay(card.fim), clean(STATUS[card.status]), '',
        ],
      })
      for (const item of card.visiveis) {
        body.push({
          kind: 'item', x: item,
          cells: [
            '', `   ${clean(item.texto)}`,
            clean(item.responsavel ? people.get(item.responsavel)?.nome : '') || '—',
            fmtDay(item.inicio), fmtDay(item.fim), clean(STATUS[item.status]), '',
          ],
        })
      }
    })
  }

  // A linha e achada pelo proprio conteudo (row.raw), nunca pelo indice: quando o autoTable
  // continua uma linha na pagina seguinte, o pedaco novo chega com indice -1.
  const meta = new Map(body.map((r) => [r.cells, r]))
  const rowOf = (c) => meta.get(c.row.raw)

  const chartX = (cell, n) => cell.x + 1 + ((n - start) / (end - start + 1)) * (cell.width - 2)

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: M + 4, bottom: M + 4 },
    theme: 'plain',
    head: [['Lista', 'Card / item', 'Responsável', 'Início', 'Fim', 'Status', '']],
    body: body.map((r) => r.cells),
    // Linha inteira na mesma pagina: a barra do cronograma nao fica cortada ao meio.
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    styles: { font: 'helvetica', fontSize: 7.5, textColor: INK, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fontStyle: 'bold', textColor: MUTED, fontSize: 6.8, lineWidth: { bottom: 0.3 }, lineColor: LINE, minCellHeight: 8, valign: 'bottom' },
    bodyStyles: { lineWidth: { bottom: 0.1 }, lineColor: LINE, minCellHeight: 6 },
    columnStyles: {
      0: { cellWidth: 30, textColor: MUTED, fontStyle: 'bold' },
      1: { cellWidth: 66 },
      2: { cellWidth: 30 },
      3: { cellWidth: 14, textColor: MUTED },
      4: { cellWidth: 14, textColor: MUTED },
      5: { cellWidth: 24 },
      [CHART]: { cellWidth: 'auto' },
    },
    didParseCell: (c) => {
      const row = c.section === 'body' && rowOf(c)
      if (!row) return
      if (row.kind === 'card' && c.column.index === 1) c.cell.styles.fontStyle = 'bold'
      if (row.kind === 'item' && c.column.index <= 2) c.cell.styles.textColor = c.column.index === 1 ? [51, 65, 85] : MUTED
      if (c.column.index === 5) c.cell.styles.textColor = TONES[row.x.status]?.fg || MUTED
    },
    didDrawCell: (c) => {
      if (c.column.index !== CHART || !range) return
      const cell = c.cell
      if (c.section === 'head') {
        doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(...MUTED)
        for (const t of ticks) {
          const x = chartX(cell, t.n)
          if (x < cell.x + cell.width - 6) doc.text(clean(t.label), x + 0.6, cell.y + cell.height - 1.6)
        }
        return
      }
      doc.setDrawColor(...GRID).setLineWidth(0.15)
      for (const t of ticks) {
        const x = chartX(cell, t.n)
        doc.line(x, cell.y, x, cell.y + cell.height)
      }
      if (today >= start && today <= end) {
        const x = chartX(cell, today + 0.5)
        doc.setDrawColor(...TODAY).setLineWidth(0.3)
        doc.line(x, cell.y, x, cell.y + cell.height)
      }
      const row = rowOf(c)
      const x = row && row.x
      if (!x || !x.inicio) return
      const tone = TONES[x.status] || TONES.futuro
      const x1 = chartX(cell, dayNum(x.inicio))
      const x2 = chartX(cell, dayNum(x.fim) + 1)
      const cy = cell.y + cell.height / 2
      if (x.marco) {
        const r = row.kind === 'card' ? 1.3 : 1
        const cx = (x1 + x2) / 2
        doc.setFillColor(...tone.fg)
        doc.triangle(cx - r, cy, cx, cy - r, cx + r, cy, 'F')
        doc.triangle(cx - r, cy, cx, cy + r, cx + r, cy, 'F')
        return
      }
      const w = Math.max(x2 - x1, 0.6)
      if (row.kind === 'card') {
        const h = 2.8
        doc.setFillColor(...tone.bg).setDrawColor(...tone.fg).setLineWidth(0.2)
        doc.roundedRect(x1, cy - h / 2, w, h, 0.6, 0.6, 'FD')
        const pw = x.status === 'concluido' ? w : w * row.pct
        if (pw > 0.2) {
          doc.setFillColor(...tone.fg)
          doc.roundedRect(x1, cy - h / 2, pw, h, 0.6, 0.6, 'F')
        }
      } else {
        const h = 1.6
        doc.setFillColor(...tone.fg)
        doc.roundedRect(x1, cy - h / 2, w, h, 0.5, 0.5, 'F')
      }
    },
  })

  if (!body.length) {
    doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(...MUTED)
    doc.text('Nenhum card para os filtros escolhidos.', M, y + 12)
  }

  // Rodape com paginacao
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
    doc.text(clean(`Cronograma · ${data.quadro.nome}`), M, H - M + 5)
    doc.text(`${i} / ${pages}`, W - M, H - M + 5, { align: 'right' })
  }

  const slug = data.quadro.nome.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  doc.save(`produzia-cronograma-${slug || 'quadro'}-${data.hoje}.pdf`)
}
