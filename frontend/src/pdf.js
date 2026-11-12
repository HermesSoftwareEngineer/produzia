import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmt, longDate, shortDate, weekday } from './format.js'
import { PATHS } from './icons.js'
import { pendingGroups } from './resumo.js'

const INK = [15, 23, 42]
const MUTED = [100, 116, 139]
const LINE = [226, 232, 240]
const BRAND = [15, 118, 110]
const BAD = [185, 28, 28]
const TONES = {
  good: { fg: [13, 148, 136], bg: [230, 255, 250] },
  indigo: { fg: [99, 102, 241], bg: [224, 231, 255] },
  amber: { fg: [217, 119, 6], bg: [255, 251, 235] },
  bad: { fg: [220, 38, 38], bg: [254, 242, 242] },
  muted: { fg: [100, 116, 139], bg: [241, 245, 249] },
}
const M = 14 // margem em mm
const ICON_COL = 8 // largura da coluna de icones (mm)

// Desenha o caminho SVG num canvas e devolve um PNG, para o jsPDF incorporar.
const iconCache = new Map()
function iconPng(name, rgb, size = 96) {
  const key = `${name}:${rgb.join(',')}`
  if (!iconCache.has(key)) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.scale(size / 24, size / 24)
    ctx.fillStyle = `rgb(${rgb.join(',')})`
    ctx.fill(new Path2D(PATHS[name]))
    iconCache.set(key, canvas.toDataURL('image/png'))
  }
  return iconCache.get(key)
}

export function drawIcon(doc, name, x, y, size, rgb) {
  // O apelido faz o jsPDF incorporar cada icone uma vez so.
  doc.addImage(iconPng(name, rgb), 'PNG', x, y, size, size, `i-${name}-${rgb.join('-')}`, 'FAST')
}

// Icone dentro de um quadrado arredondado colorido, como na tela.
function drawBadge(doc, name, tone, x, y, size = 5) {
  const t = TONES[tone] || TONES.muted
  doc.setFillColor(...t.bg)
  doc.roundedRect(x, y, size, size, 1.2, 1.2, 'F')
  const pad = size * 0.2
  drawIcon(doc, name, x + pad, y + pad, size - 2 * pad, t.fg)
}

// As fontes padrao do PDF so cobrem Latin-1/cp1252: remove emojis e simbolos fora disso.
const CP1252_EXTRA = new Set('–—‘’“”•…€'.split(''))
export function clean(text) {
  if (!text) return ''
  return [...String(text).replace(/→/g, '->')]
    .filter((ch) => ch.charCodeAt(0) <= 255 || CP1252_EXTRA.has(ch))
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const cardLabel = (card) => clean([card.nome, card.quadro, card.lista].filter(Boolean).join(' · '))
const STATUS_ONE = { atrasado: 'Atrasado', hoje: 'Vence no dia', andamento: 'Em andamento', prazo: 'No prazo' }
const statusLabel = (s) => STATUS_ONE[s] || 'Sem prazo'
const iconCell = (e) => ({ content: '', icone: e.icone, tom: e.tom })

export function exportResumoPdf({ data, people, day, boardsLabel, sections, filtered }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
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
  y += 15

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...INK)
  doc.text('Resumo do dia', M, y)
  y += 7
  drawIcon(doc, 'calendar', M, y - 3.4, 4, MUTED)
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...INK)
  doc.text(clean(`${capitalize(weekday(day))}, ${longDate(day)}`), M + 5.5, y)
  y += 5.5
  drawIcon(doc, 'board', M, y - 3, 3.6, MUTED)
  doc.setFontSize(8.5).setTextColor(...MUTED)
  const scope = doc.splitTextToSize(clean(`${boardsLabel}${filtered ? ' · lista de pessoas filtrada' : ''}`), W - 2 * M - 6)
  doc.text(scope, M + 5.5, y)
  y += scope.length * 4 + 4

  // Totais da equipe
  const t = data.totais
  const metrics = [
    ['item', 'good', t.itensConcluidos, 'itens feitos'],
    ['card', 'indigo', t.cardsConcluidos, 'cards concluídos'],
    ['comment', 'amber', t.comentarios, 'comentários'],
    ['circle', t.itensAtrasados ? 'bad' : 'muted', t.itensPendentes, `itens pendentes${t.itensAtrasados ? ` (${t.itensAtrasados} atras.)` : ''}`],
    ['clock', t.cardsAtrasados ? 'bad' : 'muted', t.cardsPendentes, `cards pendentes${t.cardsAtrasados ? ` (${t.cardsAtrasados} atras.)` : ''}`],
  ]
  const colW = (W - 2 * M) / metrics.length
  doc.setDrawColor(...LINE).setLineWidth(0.3)
  doc.line(M, y, W - M, y)
  metrics.forEach(([icon, tone, value, label], i) => {
    const x = M + i * colW
    drawBadge(doc, icon, tone, x, y + 4, 6)
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...INK)
    doc.text(fmt(value), x + 8, y + 9.2)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED)
    doc.text(clean(label), x, y + 15)
  })
  y += 19
  doc.line(M, y, W - M, y)
  y += 8

  const tableBase = {
    margin: { left: M, right: M, top: M + 4, bottom: M + 4 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 1.5, right: 1.5 }, overflow: 'linebreak', valign: 'top' },
    headStyles: { fontStyle: 'bold', textColor: MUTED, fontSize: 7, lineWidth: { bottom: 0.3 }, lineColor: LINE },
    bodyStyles: { lineWidth: { bottom: 0.1 }, lineColor: LINE, minCellHeight: 7 },
    didDrawCell: (c) => {
      if (c.section === 'body' && c.column.index === 0 && c.cell.raw?.icone) {
        drawBadge(doc, c.cell.raw.icone, c.cell.raw.tom, c.cell.x + 1, c.cell.y + 1.2, 4.6)
      }
    },
  }

  const ensureSpace = (needed) => {
    if (y + needed > H - M - 6) {
      doc.addPage()
      y = M + 4
    }
  }

  const subtitle = (icon, text) => {
    ensureSpace(16)
    drawIcon(doc, icon, M, y - 2.7, 3.4, MUTED)
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED)
    doc.text(clean(text).toUpperCase(), M + 4.6, y)
    y += 2
  }

  const table = (head, body, columnStyles, extra = {}) => {
    autoTable(doc, {
      ...tableBase, startY: y, head: [['', ...head]], body,
      columnStyles: { 0: { cellWidth: ICON_COL }, ...columnStyles }, ...extra,
    })
    y = doc.lastAutoTable.finalY + 6
  }

  people.forEach(({ pessoa, totais: pt, feeds }, index) => {
    const done = feeds.concluidos.length
    const pending = feeds.pendentes.length
    const late = pt.itensAtrasados + pt.cardsAtrasados
    ensureSpace(26)
    if (index > 0) y += 2

    // Avatar com as iniciais
    doc.setFillColor(...TONES.good.bg)
    doc.circle(M + 3.2, y - 1.4, 3.2, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...TONES.good.fg)
    doc.text(clean(pessoa.iniciais || '?'), M + 3.2, y - 0.3, { align: 'center' })

    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK)
    doc.text(clean(pessoa.nome), M + 8.5, y)

    // Resumo da pessoa a direita, cada numero com seu icone
    const parts = [
      ['check', TONES.good.fg, `${done} concluídos`],
      ['clock', late ? BAD : MUTED, `${pending} pendentes${late ? ` (${late} atrasados)` : ''}`],
      ['comment', TONES.amber.fg, `${pt.comentarios} comentários`],
    ]
    doc.setFont('helvetica', 'normal').setFontSize(8.5)
    let x = W - M
    for (const [icon, color, label] of parts.reverse()) {
      const text = clean(label)
      const w = doc.getTextWidth(text)
      x -= w
      doc.setTextColor(...MUTED)
      doc.text(text, x, y)
      x -= 4
      drawIcon(doc, icon, x, y - 2.8, 3.2, color)
      x -= 4
    }
    y += 3
    doc.setDrawColor(...INK).setLineWidth(0.4)
    doc.line(M, y, W - M, y)
    y += 5.5

    let wrote = false
    if (sections.concluidos && done) {
      subtitle('check', `Concluídos (${done})`)
      table(['Hora', 'Descrição', 'Card · Quadro · Lista'],
        feeds.concluidos.map((e) => [iconCell(e), e.hora, clean([e.titulo, e.nota].filter(Boolean).join('\n')), cardLabel(e.card)]),
        { 1: { cellWidth: 12, textColor: MUTED }, 2: { cellWidth: 88 } })
      wrote = true
    }
    if (sections.pendentes && pending) {
      subtitle('clock', `Pendentes (${pending})`)
      const rows = pendingGroups(feeds.pendentes).flatMap((g) => g.items.map((e) => [
        iconCell(e), statusLabel(e.status), e.prazo ? shortDate(e.prazo) : '', clean(e.titulo), cardLabel(e.card),
      ]))
      table(['Situação', 'Prazo', 'Descrição', 'Card · Quadro · Lista'], rows,
        { 1: { cellWidth: 22 }, 2: { cellWidth: 13, textColor: MUTED }, 3: { cellWidth: 74 } },
        { didParseCell: (c) => { if (c.section === 'body' && c.column.index === 1 && c.cell.raw === 'Atrasado') c.cell.styles.textColor = BAD } })
      wrote = true
    }
    if (sections.comentarios && feeds.comentarios.length) {
      subtitle('comment', `Comentários (${feeds.comentarios.length})`)
      table(['Hora', 'Card · Quadro · Lista', 'Comentário'],
        feeds.comentarios.map((e) => [iconCell(e), e.hora, cardLabel({ ...e.card, nome: e.titulo }), clean(e.citacao)]),
        { 1: { cellWidth: 12, textColor: MUTED }, 2: { cellWidth: 58 } })
      wrote = true
    }
    if (sections.atividade && feeds.atividade.length) {
      subtitle('move', `Outras atividades (${feeds.atividade.length})`)
      table(['Hora', 'Ação', 'Card', 'Detalhe'],
        feeds.atividade.map((e) => [iconCell(e), e.hora, e.tipo, cardLabel({ ...e.card, nome: e.titulo }), clean(e.nota)]),
        { 1: { cellWidth: 12, textColor: MUTED }, 2: { cellWidth: 14, textColor: MUTED }, 3: { cellWidth: 86 } })
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
