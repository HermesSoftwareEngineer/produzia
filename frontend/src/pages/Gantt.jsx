import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBoards } from '../boards.jsx'
import { InlineText } from '../components/CardDrawer.jsx'
import { useCardEditor } from '../components/editorContext.js'
import { useToast } from '../components/Toasts.jsx'
import { Avatar, Empty, ErrorBox, Icon, Warnings } from '../components/ui.jsx'
import { cardApi } from '../edit.js'
import { fmt } from '../format.js'
import {
  STATUS, ZOOMS, dayLabel, dayNum, filterCards, groupByList, progress, scaleTiers, timelineRange, weekendIndexes,
} from '../gantt.js'
import { useFetch } from '../useFetch.js'

const KEY_BOARD = 'produzia.gantt.quadro'
const KEY_ZOOM = 'produzia.gantt.zoom'
const KEY_LEFT = 'produzia.gantt.esquerda'
const KEY_LINKS = 'produzia.gantt.predecessoras'
const KEY_WRAP = 'produzia.gantt.quebrar'
const LINK_NAMES = { TI: 'término→início', II: 'início→início', TT: 'término→término', IT: 'início→término' }
const LEFT_DEFAULT = 340
const LEFT_MIN = 160
const LEFT_MAX_RATIO = 0.75 // a linha do tempo fica com pelo menos um quarto da largura

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function store(key, value) {
  try { localStorage.setItem(key, value) } catch { /* sem storage */ }
}

export default function Gantt() {
  const { boards, loaded, version } = useBoards()
  const [boardId, setBoardId] = useState(() => readStored(KEY_BOARD, ''))
  const [zoom, setZoomState] = useState(() => {
    const z = readStored(KEY_ZOOM, 'semana')
    return ZOOMS.some((x) => x.key === z) ? z : 'semana'
  })
  const [pessoa, setPessoa] = useState('')
  const [ocultarConcluidos, setOcultarConcluidos] = useState(false)
  const [soComDatas, setSoComDatas] = useState(false)
  const [showLinks, setShowLinksState] = useState(() => readStored(KEY_LINKS, '1') !== '0')
  const setShowLinks = (on) => { setShowLinksState(on); store(KEY_LINKS, on ? '1' : '0') }
  const [wrap, setWrapState] = useState(() => readStored(KEY_WRAP, '0') === '1')
  const setWrap = (on) => { setWrapState(on); store(KEY_WRAP, on ? '1' : '0') }
  const [open, setOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const { openCard } = useCardEditor()

  const board = boards.find((b) => b.id === boardId) || boards[0]
  const hasLinksFor = (d) => Boolean(d?.cards?.some((c) => c.itens.some((i) => i.predecessoras?.length)))
  const selectBoard = (id) => {
    setBoardId(id)
    setPessoa('')
    setOpen(new Set())
    store(KEY_BOARD, id)
  }
  const setZoom = (z) => {
    setZoomState(z)
    store(KEY_ZOOM, z)
  }

  const path = board ? `/gantt?quadro=${board.id}` : null
  const { data, error, loading } = useFetch(path, [path, version])
  const fetched = data && board && data.quadro.id === board.id ? data : null

  // Alterações feitas aqui (marcar item, renomear) aparecem na hora, antes de o Power-Up responder.
  // Chegando dados novos do servidor, elas já estão neles.
  const [patches, setPatches] = useState(() => new Map())
  useEffect(() => { setPatches(new Map()) }, [data])
  const current = useMemo(() => applyPatches(fetched, patches), [fetched, patches])
  const patchItem = (id, patch) => setPatches((prev) => new Map(prev).set(id, { ...prev.get(id), ...patch }))

  async function saveItem(card, item, patch, { text, undo } = {}) {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, item[k]]))
    patchItem(item.id, patch)
    try {
      await cardApi.updateItem(card.id, item.id, patch)
      if (text) {
        toast({ text, tone: 'good', action: undo ? { label: 'Desfazer', onClick: () => saveItem(card, { ...item, ...patch }, before) } : undefined })
      }
    } catch (err) {
      patchItem(item.id, before)
      toast({ text: `Não foi possível salvar: ${err.message}`, tone: 'bad' })
    }
  }
  const editing = {
    toggle: (card, item) => saveItem(card, item, { feito: !item.feito }, { text: item.feito ? 'Item reaberto.' : 'Item concluído.', undo: true }),
    rename: (card, item, texto) => saveItem(card, item, { texto }, { text: 'Item renomeado.', undo: true }),
    open: (card, item) => openCard?.(card.id, { itemId: item?.id }),
  }

  const people = useMemo(() => new Map((current?.pessoas || []).map((p) => [p.id, p])), [current])
  const visible = useMemo(
    () => (current ? filterCards(current.cards, { pessoa, ocultarConcluidos, soComDatas }) : []),
    [current, pessoa, ocultarConcluidos, soComDatas],
  )
  const groups = useMemo(() => (current ? groupByList(current.listas, visible) : []), [current, visible])
  const hasLinks = hasLinksFor(current)

  if (loaded && !boards.length) {
    return <Empty title="Nenhum quadro cadastrado">Cadastre um quadro em <Link to="/quadros">Quadros</Link> para ver o cronograma.</Empty>
  }

  const withItems = visible.filter((c) => c.visiveis.length)
  const allOpen = withItems.length > 0 && withItems.every((c) => open.has(c.id))
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const late = visible.filter((c) => c.status === 'atrasado').length
  const dated = visible.filter((c) => c.inicio).length

  async function exportPdf() {
    setBusy(true)
    try {
      const { exportGanttPdf } = await import('../ganttPdf.js')
      exportGanttPdf({ data: current, groups, people, filtros: { pessoa: people.get(pessoa)?.nome, ocultarConcluidos, soComDatas } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page gt-page">
      <div className="gt-head-row">
        <label className="gt-board" title="Quadro do cronograma">
          <Icon name="board" />
          <select value={board?.id || ''} onChange={(e) => selectBoard(e.target.value)} aria-label="Quadro">
            {boards.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
          <Icon name="chevron" className="gt-select-caret" />
        </label>
        <div className="gt-actions">
          {loading && current && <span className="spinner sm" title="Atualizando" />}
          <div className="segmented" role="group" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button key={z.key} type="button" className={zoom === z.key ? 'active' : ''} onClick={() => setZoom(z.key)}>{z.label}</button>
            ))}
          </div>
          <button className="btn btn-ghost" type="button" disabled={!current || busy || !visible.length} onClick={exportPdf}>
            <Icon name="download" />{busy ? 'Gerando…' : 'Exportar PDF'}
          </button>
        </div>
      </div>

      <ErrorBox error={error} />
      {current && <Warnings items={current.avisos} />}

      {current && (
        <div className="gt-toolbar">
          <label className="gt-person">
            <span>Pessoa</span>
            <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="">Todas</option>
              {current.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={ocultarConcluidos} onChange={(e) => setOcultarConcluidos(e.target.checked)} />
            <span>Ocultar concluídos</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={soComDatas} onChange={(e) => setSoComDatas(e.target.checked)} />
            <span>Só com datas</span>
          </label>
          <label className="toggle" title="Mostra o texto inteiro dos cards e itens, em várias linhas">
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
            <span>Quebrar linha</span>
          </label>
          {hasLinks && (
            <label className="toggle" title="Linhas ligando cada item às suas predecessoras">
              <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
              <span>Mostrar predecessoras</span>
            </label>
          )}
          <span className="gt-count">
            {fmt(visible.length)} cards · {fmt(dated)} com datas{late > 0 && <b> · {fmt(late)} atrasados</b>}
          </span>
          {withItems.length > 0 && (
            <button className="link-btn" type="button"
              onClick={() => setOpen(allOpen ? new Set() : new Set(withItems.map((c) => c.id)))}>
              {allOpen ? 'Recolher todos' : 'Expandir todos'}
            </button>
          )}
        </div>
      )}

      {loading && !current ? <GanttSkeleton /> : current && (
        !current.cards.length
          ? <Empty title="Quadro sem cards abertos">Os cards abertos do quadro aparecem aqui com suas datas.</Empty>
          : (
            <>
              {!current.intervalo && (
                <p className="gt-note">
                  <Icon name="calendar" />
                  Nenhum card ou item com datas neste quadro. Defina início e entrega nos cards do Trello
                  ou datas nos itens de checklist do Power-Up para ver as barras.
                </p>
              )}
              {visible.length
                ? <Timeline data={current} groups={groups} zoom={zoom} people={people} open={open} onToggle={toggle}
                  showLinks={showLinks && hasLinks} wrap={wrap} editing={editing} />
                : <Empty title="Nada para mostrar">Nenhum card com esses filtros.</Empty>}
              <Legend links={showLinks && hasLinks} />
            </>
          )
      )}
    </div>
  )
}

function GanttSkeleton() {
  return (
    <div className="gt-frame gt-skeleton" aria-busy="true" aria-label="Buscando dados no Trello">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="gt-sk-row">
          <span className="sk sk-line" style={{ width: `${40 + ((i * 17) % 45)}%` }} />
          <span className="sk sk-bar" style={{ marginLeft: `${(i * 23) % 50}%`, width: `${15 + ((i * 11) % 30)}%` }} />
        </div>
      ))}
    </div>
  )
}

function Legend({ links }) {
  return (
    <div className="gt-legend" aria-label="Legenda">
      {['concluido', 'atrasado', 'andamento', 'futuro'].map((s) => (
        <span key={s}><i className={`gt-swatch s-${s}`} />{STATUS[s]}</span>
      ))}
      <span><i className="gt-swatch gt-swatch-today" />Hoje</span>
      <span><i className="gt-swatch gt-swatch-marco" />Marco (uma data só)</span>
      {links && <span><i className="gt-swatch gt-swatch-link" />Predecessora</span>}
      {links && <span><i className="gt-swatch gt-swatch-link late" />Datas em conflito</span>}
    </div>
  )
}

// Largura da coluna da lista, ajustada arrastando o divisor (lembrada no navegador).
function useSplit(frameRef) {
  const [stored, setStored] = useState(() => {
    const n = Number(readStored(KEY_LEFT, ''))
    return Number.isFinite(n) && n >= LEFT_MIN ? n : LEFT_DEFAULT
  })
  const [frameW, setFrameW] = useState(0)

  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return undefined
    const update = () => setFrameW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [frameRef])

  const max = frameW ? Math.max(LEFT_MIN, Math.floor(frameW * LEFT_MAX_RATIO)) : 4000
  const clamp = (n) => Math.round(Math.min(max, Math.max(LEFT_MIN, n)))
  const width = clamp(stored)
  const set = (n, save = true) => {
    const v = clamp(n)
    setStored(v)
    if (save) store(KEY_LEFT, String(v))
  }
  return { width, min: LEFT_MIN, max, set }
}

function Splitter({ split }) {
  const [dragging, setDragging] = useState(false)

  function onPointerDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = split.width
    let last = startW
    setDragging(true)
    const move = (ev) => { last = startW + ev.clientX - startX; split.set(last, false) }
    const up = () => {
      split.set(last)
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onKeyDown(e) {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft') { e.preventDefault(); split.set(split.width - step) }
    if (e.key === 'ArrowRight') { e.preventDefault(); split.set(split.width + step) }
    if (e.key === 'Home') { e.preventDefault(); split.set(split.min) }
    if (e.key === 'End') { e.preventDefault(); split.set(split.max) }
  }

  return (
    <div
      className={`gt-resizer ${dragging ? 'dragging' : ''}`}
      style={{ left: split.width }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura da lista de tarefas"
      aria-valuenow={split.width}
      aria-valuemin={split.min}
      aria-valuemax={split.max}
      tabIndex={0}
      title="Arraste para ajustar a largura da lista (duplo clique volta ao padrão)"
      onPointerDown={onPointerDown}
      onDoubleClick={() => split.set(LEFT_DEFAULT)}
      onKeyDown={onKeyDown}
    >
      <span className="gt-resizer-grip" />
    </div>
  )
}

// Datas em conflito com o vinculo (mesmas regras do Power-Up).
function linkConflict(item, pred, tipo, lag) {
  const plus = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const rules = { TI: [pred.fim, 1, item.inicio], II: [pred.inicio, 0, item.inicio],
    TT: [pred.fim, 0, item.fim], IT: [pred.inicio, 0, item.fim] }
  const [base, extra, field] = rules[tipo] || rules.TI
  if (base && field && field < plus(base, extra + (lag || 0))) return true
  return (tipo === 'TI' || tipo === 'TT') && item.feito && !pred.feito
}

function Timeline({ data, groups, zoom, people, open, onToggle, showLinks, wrap, editing }) {
  const scrollRef = useRef(null)
  const frameRef = useRef(null)
  const split = useSplit(frameRef)
  const [tip, setTip] = useState(null)
  const range = useMemo(() => timelineRange(data.intervalo, data.hoje, zoom), [data, zoom])
  const tiers = useMemo(() => scaleTiers(range, zoom), [range, zoom])
  const weekends = useMemo(() => (zoom === 'dia' ? weekendIndexes(range) : []), [range, zoom])
  const { px } = range
  const width = Math.round(range.days * px)
  const todayX = (dayNum(data.hoje) - range.start) * px

  // Abre com o dia de hoje à vista (um terço da área visível).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const left = el.querySelector('.gt-corner')?.offsetWidth || 0
    el.scrollLeft = Math.max(0, todayX - (el.clientWidth - left) / 3)
  }, [todayX, data.quadro.id])

  useEffect(() => {
    if (!tip) return undefined
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [tip])

  const bar = (x) => {
    const from = dayNum(x.inicio) - range.start
    const len = dayNum(x.fim) - dayNum(x.inicio) + 1
    return { left: from * px, width: Math.max(len * px, 2) }
  }

  const tipHandlers = (title, x, extra) => ({
    onMouseMove: (e) => setTip({ x: e.clientX, y: e.clientY, title, x2: x, extra }),
    onMouseLeave: () => setTip(null),
    onFocus: (e) => {
      const r = e.currentTarget.getBoundingClientRect()
      setTip({ x: r.left, y: r.bottom, title, x2: x, extra })
    },
    onBlur: () => setTip(null),
  })

  const names = (ids) => ids.map((id) => people.get(id)?.nome).filter(Boolean).join(', ')

  // --- Predecessoras: setas entre as barras ---
  const bodyRef = useRef(null)
  const [rows, setRows] = useState({})
  const itemIndex = useMemo(() => {
    const map = new Map()
    groups.forEach(({ cards }) => cards.forEach((card) => card.visiveis.forEach((item) => map.set(item.id, { item, card }))))
    return map
  }, [groups])

  // Posicao vertical de cada linha (card ou item), medida depois de desenhar. Com "Quebrar linha" a
  // altura varia: mede de novo quando o corpo muda de tamanho (largura da lista, fontes, janela).
  const [measure, setMeasure] = useState(0)
  useLayoutEffect(() => {
    if (!showLinks || !bodyRef.current) return
    const top = bodyRef.current.getBoundingClientRect().top
    const next = {}
    bodyRef.current.querySelectorAll('[data-row]').forEach((el) => {
      const r = el.getBoundingClientRect()
      next[el.dataset.row] = r.top - top + r.height / 2
    })
    setRows(next)
  }, [showLinks, groups, open, zoom, split.width, wrap, measure])

  useEffect(() => {
    const el = bodyRef.current
    if (!showLinks || !el) return undefined
    let h = el.offsetHeight
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight !== h) { h = el.offsetHeight; setMeasure((n) => n + 1) }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [showLinks])

  const links = useMemo(() => {
    if (!showLinks) return []
    const out = []
    const anchor = ({ item, card }) => (open.has(card.id) ? `item:${item.id}` : `card:${card.id}`)
    const edge = (x, side) => {
      const b = bar(x)
      if (x.marco) return b.left + px / 2
      return side === 'fim' ? b.left + b.width : b.left
    }
    itemIndex.forEach((succ) => {
      for (const p of succ.item.predecessoras || []) {
        const pred = itemIndex.get(p.id)
        if (!pred || !pred.item.inicio || !succ.item.inicio) continue
        const a = anchor(pred)
        const b = anchor(succ)
        if (a === b || rows[a] === undefined || rows[b] === undefined) continue
        const tipo = p.tipo || 'TI'
        const fromEnd = tipo === 'TI' || tipo === 'TT'
        const toStart = tipo === 'TI' || tipo === 'II'
        out.push({
          key: `${p.id}>${succ.item.id}`,
          x1: edge(pred.item, fromEnd ? 'fim' : 'inicio'),
          y1: rows[a],
          x2: edge(succ.item, toStart ? 'inicio' : 'fim'),
          y2: rows[b],
          fromEnd,
          toStart,
          late: linkConflict(succ.item, pred.item, tipo, p.defasagem),
        })
      }
    })
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLinks, itemIndex, rows, open, px, range.start])

  const linkPath = (l) => {
    // Cotovelos como no MS Project: sai para o lado, desce/sobe e entra na barra.
    const out = l.fromEnd ? l.x1 + 8 : l.x1 - 8
    const into = l.toStart ? l.x2 - 8 : l.x2 + 8
    const midY = l.y1 + (l.y2 > l.y1 ? 1 : -1) * Math.min(Math.abs(l.y2 - l.y1) / 2, 14)
    if ((l.toStart && out <= into) || (!l.toStart && out >= into)) {
      return `M${l.x1},${l.y1} H${out} V${l.y2} H${l.x2}`
    }
    return `M${l.x1},${l.y1} H${out} V${midY} H${into} V${l.y2} H${l.x2}`
  }

  return (
    <div className={`gt-frame ${wrap ? 'gt-wrap' : ''}`} ref={frameRef} style={{ '--gt-left': `${split.width}px` }}>
    <div className="gt-scroll" ref={scrollRef} style={{ '--gt-w': `${width}px` }}>
      <div className="gt-inner">
        <div className="gt-header">
          <div className="gt-corner"><span>Lista · card · item</span></div>
          <div className="gt-scale">
            <div className="gt-tier gt-tier-top">
              {tiers.top.map((s) => (
                <span key={s.key} style={{ left: s.from * px, width: s.len * px }}><em>{s.label}</em></span>
              ))}
            </div>
            <div className={`gt-tier gt-tier-bottom z-${zoom}`}>
              {tiers.bottom.map((s) => (
                <span key={s.key} className={s.weekend ? 'weekend' : ''} style={{ left: s.from * px, width: s.len * px }}>
                  {s.label}{s.sub && <small>{s.sub}</small>}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="gt-body" ref={bodyRef}>
          {links.length > 0 && (
            <svg className="gt-links" aria-hidden="true" width={width} height="100%">
              <defs>
                <marker id="gt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" className="gt-arrow-head" />
                </marker>
                <marker id="gt-arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" className="gt-arrow-head late" />
                </marker>
              </defs>
              {links.map((l) => (
                <path key={l.key} d={linkPath(l)} className={`gt-link ${l.late ? 'late' : ''}`}
                  markerEnd={`url(#${l.late ? 'gt-arrow-late' : 'gt-arrow'})`} />
              ))}
            </svg>
          )}
          <div className="gt-bg" aria-hidden="true">
            {weekends.map((i) => <span key={i} className="gt-weekend" style={{ left: i * px, width: px }} />)}
            {tiers.bottom.map((s) => <span key={s.key} className="gt-grid" style={{ left: s.from * px }} />)}
            <span className="gt-today" style={{ left: todayX + px / 2 }}><em>hoje</em></span>
          </div>

          {groups.map(({ lista, cards }) => (
            <div key={lista.id} className="gt-group">
              <div className="gt-row gt-row-list">
                <div className="gt-label">
                  <span className="truncate">{lista.nome}</span>
                  <span className="gt-n">{cards.length}</span>
                  {lista.concluida && <span className="gt-done-tag"><Icon name="check" />concluída</span>}
                </div>
                <div className="gt-track" />
              </div>

              {cards.map((card) => {
                const isOpen = open.has(card.id)
                const pct = progress(card)
                const extra = [
                  card.membros.length ? `Membros: ${names(card.membros)}` : 'Sem membros',
                  card.itensTotal ? `Itens: ${card.itensFeitos}/${card.itensTotal} feitos` : null,
                  card.derivado ? 'Datas calculadas pelos itens' : null,
                  card.marco ? 'Marco: só uma das datas definida' : null,
                ]
                return (
                  <div key={card.id} className="gt-card-group">
                    <div className="gt-row gt-row-card" data-row={`card:${card.id}`}>
                      <div className="gt-label">
                        {card.visiveis.length ? (
                          <button className={`gt-caret ${isOpen ? 'open' : ''}`} type="button" onClick={() => onToggle(card.id)}
                            aria-expanded={isOpen} aria-label={isOpen ? 'Recolher itens' : 'Mostrar itens'}>
                            <Icon name="chevron" />
                          </button>
                        ) : <span className="gt-caret-space" />}
                        <button type="button" className="gt-card-name gt-text" onClick={() => editing.open(card)}
                          title={`${card.nome} (abrir e editar)`}>
                          {card.nome}
                        </button>
                        {card.itensTotal > 0 && <span className="gt-n">{card.itensFeitos}/{card.itensTotal}</span>}
                        <span className="gt-avatars">
                          {card.membros.slice(0, 3).map((id) => people.get(id) && <Avatar key={id} pessoa={people.get(id)} size={20} />)}
                        </span>
                      </div>
                      <div className="gt-track">
                        {card.inicio && (card.marco ? (
                          <a className={`gt-milestone s-${card.status}`} href={card.url} target="_blank" rel="noreferrer"
                            style={{ left: bar(card).left + px / 2 }} aria-label={card.nome} {...tipHandlers(card.nome, card, extra)} />
                        ) : (
                          <a className={`gt-bar gt-bar-card s-${card.status} ${card.derivado ? 'derived' : ''}`} href={card.url}
                            target="_blank" rel="noreferrer" style={bar(card)} aria-label={card.nome} {...tipHandlers(card.nome, card, extra)}>
                            <span className="gt-prog" style={{ width: `${card.status === 'concluido' ? 100 : pct}%` }} />
                          </a>
                        ))}
                        {card.inicio && (
                          <span className="gt-bar-label" style={{ left: bar(card).left + bar(card).width + (card.marco ? 10 : 6) }}>{card.nome}</span>
                        )}
                      </div>
                    </div>

                    {isOpen && card.visiveis.map((item) => {
                      const dono = item.responsavel ? people.get(item.responsavel) : null
                      const itemExtra = [
                        item.checklist ? `Checklist: ${item.checklist}` : null,
                        `Responsável: ${dono?.nome || 'sem responsável'}`,
                        item.marco ? 'Marco: só uma das datas definida' : null,
                        ...(item.predecessoras || []).map((p) => {
                          const lag = p.defasagem ? ` ${p.defasagem > 0 ? '+' : ''}${p.defasagem}d` : ''
                          return `Depois de: ${p.texto || 'item'} (${LINK_NAMES[p.tipo] || p.tipo}${lag})${p.externa ? ' · outro quadro' : ''}`
                        }),
                      ]
                      return (
                        <div key={item.id} className="gt-row gt-row-item" data-row={`item:${item.id}`}>
                          <div className="gt-label">
                            <button type="button" className={`gt-check ${item.feito ? 'on' : ''}`} aria-pressed={item.feito}
                              aria-label={item.feito ? 'Desmarcar item' : 'Marcar item como concluído'}
                              title={item.feito ? 'Concluído (clique para reabrir)' : 'Marcar como concluído'}
                              onClick={() => editing.toggle(card, item)}>
                              <Icon name={item.feito ? 'item' : 'circle'} className={item.feito ? 'gt-item-done' : 'gt-item-open'} />
                            </button>
                            <InlineText trigger="dblclick" className={`gt-text gt-item-text ${item.feito ? 'gt-feito' : ''}`}
                              value={item.texto} label="Texto do item" onSave={(texto) => editing.rename(card, item, texto)} />
                            <button type="button" className="gt-edit" aria-label="Editar item" title="Editar item (datas, responsável…)"
                              onClick={() => editing.open(card, item)}>
                              <Icon name="edit" />
                            </button>
                            {!item.inicio && <span className="gt-nodate">sem datas</span>}
                            {dono && <Avatar pessoa={dono} size={18} />}
                          </div>
                          <div className="gt-track">
                            {item.inicio && (item.marco ? (
                              <span className={`gt-milestone gt-milestone-item s-${item.status}`} tabIndex={0} role="button"
                                style={{ left: bar(item).left + px / 2 }} {...tipHandlers(item.texto, item, itemExtra)}
                                onClick={() => editing.open(card, item)} onKeyDown={(e) => e.key === 'Enter' && editing.open(card, item)} />
                            ) : (
                              <span className={`gt-bar gt-bar-item s-${item.status}`} tabIndex={0} role="button" style={bar(item)}
                                {...tipHandlers(item.texto, item, itemExtra)}
                                onClick={() => editing.open(card, item)} onKeyDown={(e) => e.key === 'Enter' && editing.open(card, item)} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {tip && <Tooltip tip={tip} hoje={data.hoje} />}
    </div>
    <Splitter split={split} />
    </div>
  )
}

function Tooltip({ tip, hoje }) {
  const { x2: x } = tip
  const flip = tip.x > window.innerWidth - 300
  const style = { top: tip.y + 14, left: flip ? undefined : tip.x + 14, right: flip ? window.innerWidth - tip.x + 14 : undefined }
  const dates = x.marco
    ? dayLabel(x.inicio, hoje)
    : `${dayLabel(x.inicio, hoje)} → ${dayLabel(x.fim, hoje)} · ${dayNum(x.fim) - dayNum(x.inicio) + 1} dias`
  return (
    <div className="gt-tip" role="tooltip" style={style}>
      <strong>{tip.title}</strong>
      <span className="gt-tip-dates">{dates}</span>
      {tip.extra.filter(Boolean).map((line) => <span key={line}>{line}</span>)}
      <span className={`gt-tip-status s-${x.status}`}><i className={`gt-swatch s-${x.status}`} />{STATUS[x.status]}</span>
    </div>
  )
}

// --- Edição otimista -------------------------------------------------------------

// Mesmas regras do servidor (app/gantt.py).
function statusOf(done, inicio, fim, hoje) {
  if (done) return 'concluido'
  if (!fim) return 'semdata'
  if (fim < hoje) return 'atrasado'
  if (inicio && inicio > hoje) return 'futuro'
  return 'andamento'
}

function applyPatches(data, patches) {
  if (!data || !patches.size) return data
  const cards = data.cards.map((card) => {
    if (!card.itens.some((i) => patches.has(i.id))) return card
    const itens = card.itens.map((i) => {
      const p = patches.get(i.id)
      if (!p) return i
      const next = { ...i, ...p }
      return { ...next, status: statusOf(next.feito || card.concluido, next.inicio, next.fim, data.hoje) }
    })
    return { ...card, itens, itensFeitos: itens.filter((i) => i.feito).length }
  })
  return { ...data, cards }
}
