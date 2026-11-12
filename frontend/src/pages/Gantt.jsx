import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useBoards } from '../boards.jsx'
import { Avatar, Empty, ErrorBox, Icon, Loading, Warnings } from '../components/ui.jsx'
import { fmt } from '../format.js'
import {
  STATUS, ZOOMS, dayLabel, dayNum, filterCards, groupByList, progress, scaleTiers, timelineRange, weekendIndexes,
} from '../gantt.js'
import { useFetch } from '../useFetch.js'

const KEY_BOARD = 'produzia.gantt.quadro'
const KEY_ZOOM = 'produzia.gantt.zoom'

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
  const [open, setOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  const board = boards.find((b) => b.id === boardId) || boards[0]
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
  const current = data && board && data.quadro.id === board.id ? data : null

  const people = useMemo(() => new Map((current?.pessoas || []).map((p) => [p.id, p])), [current])
  const visible = useMemo(
    () => (current ? filterCards(current.cards, { pessoa, ocultarConcluidos, soComDatas }) : []),
    [current, pessoa, ocultarConcluidos, soComDatas],
  )
  const groups = useMemo(() => (current ? groupByList(current.listas, visible) : []), [current, visible])

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

      {loading && !current ? <Loading /> : current && (
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
                ? <Timeline data={current} groups={groups} zoom={zoom} people={people} open={open} onToggle={toggle} />
                : <Empty title="Nada para mostrar">Nenhum card com esses filtros.</Empty>}
              <Legend />
            </>
          )
      )}
    </div>
  )
}

function Legend() {
  return (
    <div className="gt-legend" aria-label="Legenda">
      {['concluido', 'atrasado', 'andamento', 'futuro'].map((s) => (
        <span key={s}><i className={`gt-swatch s-${s}`} />{STATUS[s]}</span>
      ))}
      <span><i className="gt-swatch gt-swatch-today" />Hoje</span>
      <span><i className="gt-swatch gt-swatch-marco" />Marco (uma data só)</span>
    </div>
  )
}

function Timeline({ data, groups, zoom, people, open, onToggle }) {
  const scrollRef = useRef(null)
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

  return (
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

        <div className="gt-body">
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
                    <div className="gt-row gt-row-card">
                      <div className="gt-label">
                        {card.visiveis.length ? (
                          <button className={`gt-caret ${isOpen ? 'open' : ''}`} type="button" onClick={() => onToggle(card.id)}
                            aria-expanded={isOpen} aria-label={isOpen ? 'Recolher itens' : 'Mostrar itens'}>
                            <Icon name="chevron" />
                          </button>
                        ) : <span className="gt-caret-space" />}
                        <a className="gt-card-name truncate" href={card.url} target="_blank" rel="noreferrer" title={`${card.nome} (abrir no Trello)`}>
                          {card.nome}
                        </a>
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
                      ]
                      return (
                        <div key={item.id} className="gt-row gt-row-item">
                          <div className="gt-label">
                            <Icon name={item.feito ? 'item' : 'circle'} className={item.feito ? 'gt-item-done' : 'gt-item-open'} />
                            <span className={`truncate ${item.feito ? 'gt-feito' : ''}`} title={item.texto}>{item.texto}</span>
                            {!item.inicio && <span className="gt-nodate">sem datas</span>}
                            {dono && <Avatar pessoa={dono} size={18} />}
                          </div>
                          <div className="gt-track">
                            {item.inicio && (item.marco ? (
                              <span className={`gt-milestone gt-milestone-item s-${item.status}`} tabIndex={0}
                                style={{ left: bar(item).left + px / 2 }} {...tipHandlers(item.texto, item, itemExtra)} />
                            ) : (
                              <span className={`gt-bar gt-bar-item s-${item.status}`} tabIndex={0} style={bar(item)}
                                {...tipHandlers(item.texto, item, itemExtra)} />
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
