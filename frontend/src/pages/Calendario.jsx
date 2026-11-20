import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { boardsQuery } from '../api.js'
import { useBoards } from '../boards.jsx'
import TaskComposer from '../components/TaskComposer.jsx'
import { useToast } from '../components/Toasts.jsx'
import { Avatar, CardLink, Empty, ErrorBox, Icon, Loading, Status, Warnings } from '../components/ui.jsx'
import { TYPES, VIEWS, WEEKDAYS, dayCounts, filterTasks, groupByDay, periodTitle, shiftDate, sortTasks, viewDays,
} from '../calendario.js'
import { cardApi, completeTask, dateShortcuts, rescheduleTask, typing, withRetry } from '../edit.js'
import { addDays, fmt, parseDay, shortDate, toIso, weekday } from '../format.js'
import { useFetch } from '../useFetch.js'
import { useCardEditor } from '../components/editorContext.js'

const itemIdOf = (t) => (t.tipo === 'item' ? t.id.replace(/^item:/, '') : undefined)
const editable = (t) => !t.card.arquivado
const DRAG_TYPE = 'application/x-produzia-tarefa'

function statusOf(concluido, prazo, hoje) {
  if (concluido) return 'concluido'
  if (prazo && prazo < hoje) return 'atrasado'
  if (prazo === hoje) return 'hoje'
  return 'pendente'
}

// Edição das tarefas do calendário: aplica na tela na hora, grava no Trello/Power-Up
// e volta atrás se der erro. Os dados do servidor são recarregados logo depois.
const TaskActions = createContext(null)
const useTaskActions = () => useContext(TaskActions)

function useTaskEdits(res, hoje) {
  const { toast } = useToast()
  const { refresh } = useBoards()
  const [patches, setPatches] = useState(() => new Map())
  const timer = useRef(null)
  const pendingWrites = useRef(0)

  // Dados novos do servidor já trazem as alterações.
  useEffect(() => { if (!pendingWrites.current) setPatches(new Map()) }, [res])
  useEffect(() => () => clearTimeout(timer.current), [])

  const refreshSoon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (!pendingWrites.current) refresh() }, 700)
  }, [refresh])

  const setPatch = useCallback((id, p) => setPatches((m) => {
    const next = new Map(m)
    if (p === null) next.delete(id)
    else next.set(id, { ...(m.get(id) || {}), ...p })
    return next
  }), [])

  const apply = useCallback((list = []) => list.flatMap((t) => {
    const p = patches.get(t.id)
    if (!p) return [t]
    if (p.removed) return []
    const n = { ...t, ...p }
    n.status = statusOf(n.concluido, n.prazo, hoje)
    if (n.concluido && !n.concluidoEm) n.concluidoEm = n.prazo || hoje
    return [n]
  }), [patches, hoje])

  // Uma escrita com otimismo: patch -> grava -> (toast com Desfazer) ou volta.
  const run = useCallback(async (t, patch, write, { text, undo, undoPatch } = {}) => {
    const before = patches.get(t.id) || null
    setPatch(t.id, patch)
    pendingWrites.current += 1
    try {
      const result = await withRetry(write)
      if (text) {
        toast({
          text, tone: 'good',
          action: undo ? {
            label: 'Desfazer',
            onClick: async () => {
              setPatch(t.id, undoPatch ?? null)
              pendingWrites.current += 1
              try { await withRetry(() => undo(result)) } catch (err) { toast({ text: err.message, tone: 'bad' }) }
              finally { pendingWrites.current -= 1; refreshSoon() }
            },
          } : undefined,
        })
      }
      return result
    } catch (err) {
      setPatches((m) => {
        const next = new Map(m)
        if (before) next.set(t.id, before)
        else next.delete(t.id)
        return next
      })
      toast({ text: err.message, tone: 'bad' })
      return undefined
    } finally {
      pendingWrites.current -= 1
      refreshSoon()
    }
  }, [patches, setPatch, toast, refreshSoon])

  const asEdit = (t) => ({ kind: t.tipo, cardId: t.card.id, itemId: itemIdOf(t), prazo: t.prazo, inicio: t.inicio })
  const short = (s) => (s.length > 48 ? `${s.slice(0, 46)}…` : s)

  const actions = useMemo(() => ({
    toggleDone(t) {
      if (!t.concluido) {
        const task = completeTask(asEdit(t))
        return run(t, { concluido: true }, task.run, {
          text: `Concluída: ${short(t.titulo)}`, undo: task.undo, undoPatch: { concluido: false },
        })
      }
      const reopen = t.tipo === 'card'
        ? () => cardApi.update(t.card.id, { concluido: false })
        : () => cardApi.updateItem(t.card.id, itemIdOf(t), { feito: false })
      const redo = t.tipo === 'card'
        ? () => cardApi.update(t.card.id, { concluido: true })
        : () => cardApi.updateItem(t.card.id, itemIdOf(t), { feito: true })
      return run(t, { concluido: false }, reopen, { text: `Reaberta: ${short(t.titulo)}`, undo: redo, undoPatch: { concluido: true } })
    },
    reschedule(t, date) {
      if (!date || date === t.prazo) return undefined
      const task = rescheduleTask(asEdit(t), date)
      const inicio = t.inicio && t.inicio > date ? date : t.inicio
      return run(t, { prazo: date, inicio }, task.run, {
        text: `Movida para ${weekday(date)}, ${shortDate(date)}`, undo: task.undo, undoPatch: { prazo: t.prazo, inicio: t.inicio },
      })
    },
    clearDate(t) {
      const write = t.tipo === 'card'
        ? () => cardApi.update(t.card.id, { prazo: null, inicio: null })
        : () => cardApi.updateItem(t.card.id, itemIdOf(t), { dataFim: null, dataInicio: null })
      const undo = t.tipo === 'card'
        ? () => cardApi.update(t.card.id, { prazo: t.prazo, inicio: t.inicio })
        : () => cardApi.updateItem(t.card.id, itemIdOf(t), { dataFim: t.prazo, dataInicio: t.inicio })
      return run(t, { removed: true }, write, { text: 'Data removida: a tarefa saiu do calendário.', undo, undoPatch: null })
    },
    rename(t, titulo) {
      const text = titulo.trim()
      if (!text || text === t.titulo) return undefined
      const write = t.tipo === 'card'
        ? () => cardApi.update(t.card.id, { nome: text })
        : () => cardApi.updateItem(t.card.id, itemIdOf(t), { texto: text })
      const undo = t.tipo === 'card'
        ? () => cardApi.update(t.card.id, { nome: t.titulo })
        : () => cardApi.updateItem(t.card.id, itemIdOf(t), { texto: t.titulo })
      return run(t, { titulo: text }, write, { text: 'Título atualizado.', undo, undoPatch: { titulo: t.titulo } })
    },
    remove(t) {
      if (t.tipo === 'card') {
        return run(t, { removed: true }, () => cardApi.archive(t.card.id, true), {
          text: `Card arquivado: ${short(t.titulo)}`, undo: () => cardApi.archive(t.card.id, false), undoPatch: null,
        })
      }
      return run(t, { removed: true }, () => cardApi.deleteItem(t.card.id, itemIdOf(t)), { text: `Item excluído: ${short(t.titulo)}` })
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [run])

  return { apply, actions, refreshSoon }
}

// Tarefa do calendário: abre o editor do card no Produzia (arquivado vai para o Trello).
function TaskOpen({ t, title, children, className = 'cal-open' }) {
  const { openCard } = useCardEditor()
  if (!openCard || t.card.arquivado) return <a className={className} href={t.card.url} target="_blank" rel="noreferrer" title={title}>{children}</a>
  return (
    <button type="button" className={className} title={title} onClick={() => openCard(t.card.id, { itemId: itemIdOf(t) })}>
      {children}
    </button>
  )
}

const MONTH_LIMIT = 4
const CURRENT_LABEL = { mes: 'Mês atual', semana: 'Semana atual', dia: 'Hoje' }
const WEEKDAY_SHORT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })

function subtitle(vista, data, today) {
  if (vista === 'dia' && data === addDays(today, -1)) return 'Ontem'
  if (vista === 'dia' && data === addDays(today, 1)) return 'Amanhã'
  return data < today ? 'Passado' : 'Próximo'
}

function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches
  const [match, setMatch] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

export default function Calendario() {
  const { boards, loaded, selected, version } = useBoards()
  const { toast } = useToast()
  const { openCard } = useCardEditor()
  const [params, setParams] = useSearchParams()
  const today = toIso(new Date())
  const vista = VIEWS.some((v) => v.key === params.get('vista')) ? params.get('vista') : 'mes'
  const rawDate = params.get('data')
  const data = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(parseDay(rawDate).getTime()) ? rawDate : today

  const [pessoa, setPessoa] = useState('')
  const [tipo, setTipo] = useState('ambos')
  const [mostrarConcluidas, setMostrarConcluidas] = useState(true)
  const [composer, setComposer] = useState(null) // null | { data }
  const [dragging, setDragging] = useState(null)
  const compact = useMediaQuery('(max-width: 700px)')

  const go = (next, { push = false } = {}) => {
    const v = next.vista ?? vista
    const d = next.data ?? data
    setParams({ vista: v, data: d }, { replace: !push })
  }
  const move = (dir) => go({ data: shiftDate(vista, data, dir) })
  const openDay = (iso) => go({ vista: 'dia', data: iso }, { push: true })
  const compose = (iso) => setComposer({ data: iso || data })

  useEffect(() => {
    const onKey = (e) => {
      if (typing(e) || e.altKey || e.ctrlKey || e.metaKey || composer || document.querySelector('.cd-overlay')) return
      if (e.key === 'ArrowLeft') move(-1)
      if (e.key === 'ArrowRight') move(1)
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); compose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const days = useMemo(() => viewDays(vista, data), [vista, data])
  const inicio = days[0]
  const fim = days[days.length - 1]
  const q = [`inicio=${inicio}`, `fim=${fim}`, boardsQuery(selected)].filter(Boolean).join('&')
  const { data: res, error, loading } = useFetch(boards.length ? `/calendario?${q}` : null, [q, version, boards.length])
  const stale = res && (res.inicio !== inicio || res.fim !== fim)
  const hoje = res?.hoje || today
  const { apply, actions, refreshSoon } = useTaskEdits(res, hoje)

  const filtros = { pessoa, tipo, mostrarConcluidas }
  const tarefas = useMemo(() => apply(res?.tarefas), [res, apply])
  const visible = useMemo(() => filterTasks(tarefas, filtros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tarefas, pessoa, tipo, mostrarConcluidas])
  const byDay = useMemo(() => groupByDay(visible), [visible])
  const byId = useMemo(() => new Map([...tarefas, ...apply(res?.atrasadas)].map((t) => [t.id, t])), [tarefas, res, apply])

  // Quadros onde dá para criar: os escolhidos no filtro (ou todos).
  const composeBoards = selected.length ? boards.filter((b) => selected.includes(b.id)) : boards

  const ctx = useMemo(() => ({
    ...actions,
    compose,
    dragging,
    startDrag: (t) => setDragging(t.id),
    endDrag: () => setDragging(null),
    dropOn: (id, day) => {
      const t = byId.get(id)
      setDragging(null)
      if (t && editable(t)) actions.reschedule(t, day)
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [actions, dragging, byId, data])

  if (loaded && !boards.length) {
    return <Empty title="Nenhum quadro cadastrado">Cadastre um quadro em <Link to="/quadros">Quadros</Link> para ver o calendário.</Empty>
  }

  function created(c, { keepOpen }) {
    if (!keepOpen) setComposer(null)
    const where = c.prazo ? ` para ${shortDate(c.prazo)}` : ' sem data'
    toast({
      text: `${c.tipo === 'card' ? 'Card criado' : 'Item criado'}${where}.`, tone: 'good',
      action: openCard ? { label: 'Abrir', onClick: () => openCard(c.cardId, { itemId: c.itemId }) } : undefined,
    })
    refreshSoon()
  }

  const inView = days.flatMap((d) => byDay.get(d) || [])
  const counts = dayCounts(inView)
  // O mês conta como atual pelo mês, não pelos dias vizinhos que completam a grade.
  const current = vista === 'mes' ? today.slice(0, 7) === data.slice(0, 7) : days.includes(today)
  const atrasadas = vista === 'dia' && data === hoje && res
    ? sortTasks(filterTasks(apply(res.atrasadas), { ...filtros, mostrarConcluidas: true }).filter((t) => t.prazo && t.prazo < data))
    : []

  return (
    <TaskActions.Provider value={ctx}>
      <div className={`page cal-page ${dragging ? 'cal-dragging' : ''}`}>
        <div className="cal-head">
          <div className="day-nav">
            <button className="btn btn-ghost btn-icon" type="button" onClick={() => move(-1)} title="Período anterior (←)">
              <Icon name="left" />
            </button>
            <label className="day-title cal-title" title="Escolher data">
              <strong>{periodTitle(vista, data, today)}</strong>
              <span>{current ? CURRENT_LABEL[vista] : subtitle(vista, data, today)}</span>
              <input type="date" value={data} aria-label="Data do calendário"
                onChange={(e) => e.target.value && go({ data: e.target.value })} />
            </label>
            <button className="btn btn-ghost btn-icon" type="button" onClick={() => move(1)} title="Próximo período (→)">
              <Icon name="right" />
            </button>
            {!current && <button className="today-link" type="button" onClick={() => go({ data: today })}>Hoje</button>}
          </div>
          <div className="cal-actions">
            {loading && res && <span className="spinner sm" title="Atualizando" />}
            <div className="segmented" role="group" aria-label="Visualização">
              {VIEWS.map((v) => (
                <button key={v.key} type="button" className={vista === v.key ? 'active' : ''}
                  onClick={() => go({ vista: v.key }, { push: true })}>{v.label}</button>
              ))}
            </div>
            <button className="btn btn-primary cal-new" type="button" onClick={() => compose()} title="Nova tarefa (N)">
              <Icon name="plus" /><span>Nova tarefa</span>
            </button>
          </div>
        </div>

        <div className="cal-toolbar">
          <label className="gt-person">
            <span>Pessoa</span>
            <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="">Todas</option>
              {(res?.pessoas || []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <div className="segmented segmented-sm" role="group" aria-label="Tipo">
            {TYPES.map((t) => (
              <button key={t.key} type="button" className={tipo === t.key ? 'active' : ''} onClick={() => setTipo(t.key)}>{t.label}</button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={mostrarConcluidas} onChange={(e) => setMostrarConcluidas(e.target.checked)} />
            <span>Mostrar concluídas</span>
          </label>
          {res && (
            <span className="gt-count cal-count">
              {fmt(counts.total)} {counts.total === 1 ? 'tarefa' : 'tarefas'} · {fmt(counts.done)} {counts.done === 1 ? 'concluída' : 'concluídas'}
              {counts.late > 0 && <b> · {fmt(counts.late)} {counts.late === 1 ? 'atrasada' : 'atrasadas'}</b>}
            </span>
          )}
        </div>

        <ErrorBox error={error} />
        {res && <Warnings items={res.avisos} />}

        {loading && !res ? <Loading /> : res && (
          <div className={`cal-body ${stale ? 'cal-stale' : ''}`}>
            {vista === 'mes' && (compact
              ? <MonthList days={days} month={data.slice(0, 7)} byDay={byDay} hoje={hoje} onPick={openDay} />
              : <MonthGrid days={days} month={data.slice(0, 7)} byDay={byDay} hoje={hoje} onPick={openDay} />)}
            {vista === 'semana' && <WeekView days={days} byDay={byDay} hoje={hoje} onPick={openDay} />}
            {vista === 'dia' && (
              <DayView day={data} list={byDay.get(data) || []} hoje={hoje} atrasadas={atrasadas} />
            )}
            {vista !== 'dia' && !inView.length && !stale && (
              <p className="feed-empty cal-empty">
                Nenhuma tarefa com prazo neste período. <button className="link-inline" type="button" onClick={() => compose()}>Criar uma tarefa</button>
              </p>
            )}
            {vista !== 'dia' && <Legend />}
          </div>
        )}
      </div>

      {composer && (
        <TaskComposer initial={composer} boards={composeBoards} onClose={() => setComposer(null)} onCreated={created} />
      )}
    </TaskActions.Provider>
  )
}

// Ícone de status que também conclui/reabre a tarefa.
function CheckButton({ t }) {
  const a = useTaskActions()
  const name = t.concluido ? (t.tipo === 'card' ? 'item' : 'checkCircle') : t.tipo === 'card' ? 'square' : 'circle'
  if (!editable(t)) return <span className={`cal-check s-${t.status}`}><Icon name={name} /></span>
  return (
    <button type="button" className={`cal-check cal-check-btn s-${t.status}`}
      title={t.concluido ? 'Reabrir' : 'Marcar como concluída'} aria-label={t.concluido ? `Reabrir ${t.titulo}` : `Concluir ${t.titulo}`}
      aria-pressed={t.concluido} onClick={(e) => { e.stopPropagation(); a.toggleDone(t) }}>
      <Icon name={name} />
      {!t.concluido && <Icon name={t.tipo === 'card' ? 'item' : 'checkCircle'} className="cal-check-hover" />}
    </button>
  )
}

function tip(t) {
  const who = t.responsaveis.map((p) => p.nome).join(', ')
  return [t.titulo, t.tipo === 'item' ? t.card.nome : null, t.card.quadro, who].filter(Boolean).join(' · ')
}

function Ratio({ list }) {
  if (!list.length) return null
  const c = dayCounts(list)
  return (
    <span className={`cal-ratio ${c.done === c.total ? 'all' : ''} ${c.late ? 'late' : ''}`} title={`${c.done} de ${c.total} concluídas`}>
      {c.done}/{c.total}
    </span>
  )
}

// Arrastar uma tarefa para outro dia (mês e semana).
function useDrag(t) {
  const a = useTaskActions()
  if (!editable(t)) return {}
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(DRAG_TYPE, t.id)
      e.dataTransfer.effectAllowed = 'move'
      a.startDrag(t)
    },
    onDragEnd: () => a.endDrag(),
  }
}

function useDrop(day) {
  const a = useTaskActions()
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  return {
    over,
    props: {
      onDragEnter: (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { depth.current += 1; setOver(true) } },
      onDragOver: (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) },
      onDrop: (e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const id = e.dataTransfer.getData(DRAG_TYPE)
        if (id) a.dropOn(id, day)
      },
    },
  }
}

function MonthGrid({ days, month, byDay, hoje, onPick }) {
  return (
    <div className="cal-month" role="grid">
      {WEEKDAYS.map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
      {days.map((d) => <MonthCell key={d} d={d} month={month} list={byDay.get(d) || []} hoje={hoje} onPick={onPick} />)}
    </div>
  )
}

function MonthCell({ d, month, list, hoje, onPick }) {
  const a = useTaskActions()
  const drop = useDrop(d)
  const extra = list.length - MONTH_LIMIT
  const cls = ['cal-cell', d.slice(0, 7) !== month && 'out', d === hoje && 'today', d < hoje && 'past', drop.over && 'drop'].filter(Boolean).join(' ')
  return (
    <div className={cls} role="gridcell" {...drop.props}
      onClick={(e) => { if (!e.target.closest('button, a, input, li')) onPick(d) }}>
      <span className="cal-cell-head">
        <button type="button" className="cal-date" onClick={() => onPick(d)} title={`Abrir ${shortDate(d)}`}>{Number(d.slice(8))}</button>
        <button type="button" className="cal-add" onClick={() => a.compose(d)} title={`Nova tarefa em ${shortDate(d)}`} aria-label={`Nova tarefa em ${shortDate(d)}`}>
          <Icon name="plus" />
        </button>
        <Ratio list={list} />
      </span>
      <ul className="cal-minis">
        {list.slice(0, extra > 0 ? MONTH_LIMIT - 1 : MONTH_LIMIT).map((t) => <MonthMini key={t.id} t={t} />)}
        {extra > 0 && (
          <li><button type="button" className="cal-more" onClick={() => onPick(d)}>+{extra + 1} mais</button></li>
        )}
      </ul>
    </div>
  )
}

function MonthMini({ t }) {
  const a = useTaskActions()
  const drag = useDrag(t)
  return (
    <li className={`cal-mini ${t.concluido ? 'done' : ''} ${a.dragging === t.id ? 'is-dragging' : ''}`} {...drag}>
      <CheckButton t={t} />
      <TaskOpen t={t} title={tip(t)} className="cal-mini-open truncate">{t.titulo}</TaskOpen>
    </li>
  )
}

function MonthList({ days, month, byDay, hoje, onPick }) {
  const withTasks = days.filter((d) => d.slice(0, 7) === month && (byDay.get(d) || []).length)
  if (!withTasks.length) return null
  return (
    <div className="cal-mlist">
      {withTasks.map((d) => (
        <DayColumn key={d} day={d} list={byDay.get(d)} hoje={hoje} onPick={onPick} listMode />
      ))}
    </div>
  )
}

function WeekView({ days, byDay, hoje, onPick }) {
  return (
    <div className="cal-week">
      {days.map((d) => <DayColumn key={d} day={d} list={byDay.get(d) || []} hoje={hoje} onPick={onPick} />)}
    </div>
  )
}

function DayColumn({ day, list, hoje, onPick, listMode }) {
  const a = useTaskActions()
  const drop = useDrop(day)
  const date = parseDay(day)
  return (
    <section className={`cal-col ${day === hoje ? 'today' : ''} ${listMode ? 'as-list' : ''} ${drop.over ? 'drop' : ''}`} {...drop.props}>
      <div className="cal-col-top">
        <button type="button" className="cal-col-head" onClick={() => onPick(day)} title="Abrir o dia">
          <span className="cal-col-wd">{WEEKDAY_SHORT.format(date).replace('.', '')}</span>
          <span className="cal-col-date">{date.getDate()}</span>
          {listMode && <span className="cal-col-month">{shortDate(day)}</span>}
          <Ratio list={list} />
        </button>
        <button type="button" className="cal-add" onClick={() => a.compose(day)} title={`Nova tarefa em ${shortDate(day)}`} aria-label={`Nova tarefa em ${shortDate(day)}`}>
          <Icon name="plus" />
        </button>
      </div>
      {list.length ? (
        <ul className="cal-col-list">
          {list.map((t) => <WeekLine key={t.id} t={t} />)}
        </ul>
      ) : <p className="cal-col-empty">{drop.over ? 'Soltar aqui' : '—'}</p>}
    </section>
  )
}

function WeekLine({ t }) {
  const a = useTaskActions()
  const drag = useDrag(t)
  return (
    <li className={`cal-line ${t.concluido ? 'done' : ''} ${a.dragging === t.id ? 'is-dragging' : ''}`} {...drag}>
      <CheckButton t={t} />
      <TaskOpen t={t} title={tip(t)}>
        <span className="cal-line-title">{t.titulo}</span>
        <span className="cal-line-meta">{t.tipo === 'card' ? `Card · ${t.card.quadro}` : t.card.nome}</span>
      </TaskOpen>
    </li>
  )
}

function DayView({ day, list, hoje, atrasadas }) {
  const a = useTaskActions()
  const pendentes = list.filter((t) => !t.concluido)
  const concluidas = list.filter((t) => t.concluido)
  const late = pendentes.filter((t) => t.status === 'atrasado').length
  const pct = list.length ? Math.round((100 * concluidas.length) / list.length) : null

  return (
    <div className="cal-day">
      <div className="rs-summary cal-summary">
        <div className="metric"><strong>{fmt(list.length)}</strong><span className="metric-label"><Icon name="calgrid" />tarefas no dia</span></div>
        <div className={`metric ${concluidas.length ? 'metric-good' : ''}`}>
          <strong>{fmt(concluidas.length)}</strong><span className="metric-label"><Icon name="check" />concluídas</span>
        </div>
        <div className="metric">
          <strong>{fmt(pendentes.length)}</strong><span className="metric-label"><Icon name="circle" />pendentes</span>
          {late > 0 && <em>{fmt(late)} atrasadas</em>}
        </div>
        <div className="metric">
          <strong>{pct === null ? '—' : `${pct}%`}</strong><span className="metric-label"><Icon name="bars" />do dia concluído</span>
          {pct !== null && <div className="cal-progress"><span style={{ width: `${pct}%` }} /></div>}
        </div>
      </div>

      {atrasadas.length > 0 && (
        <details className="cal-overdue" open={atrasadas.length <= 5}>
          <summary>
            <Icon name="chevron" className="caret" />
            Atrasadas de dias anteriores<span className="n">{atrasadas.length}</span>
            <span className="cal-overdue-hint">use <Icon name="more" /> ou o ícone para reagendar ou concluir</span>
          </summary>
          <ul className="feed">{atrasadas.map((t) => <DayItem key={t.id} t={t} showDate />)}</ul>
        </details>
      )}

      <div className={`feed-group ${late ? 'late' : ''}`}>Pendentes · {pendentes.length}</div>
      {pendentes.length
        ? <ul className="feed">{pendentes.map((t) => <DayItem key={t.id} t={t} />)}</ul>
        : <p className="feed-empty">{day === hoje ? 'Nada pendente para hoje.' : 'Nenhuma pendência com prazo neste dia.'}</p>}
      <button type="button" className="cal-quick-add" onClick={() => a.compose(day)}>
        <span className="cal-quick-plus"><Icon name="plus" /></span>Adicionar tarefa em {shortDate(day)}
        <kbd>N</kbd>
      </button>

      <div className="feed-group">Concluídas · {concluidas.length}</div>
      {concluidas.length
        ? <ul className="feed">{concluidas.map((t) => <DayItem key={t.id} t={t} />)}</ul>
        : <p className="feed-empty">Nada concluído entre as tarefas deste dia.</p>}
    </div>
  )
}

function DayItem({ t, showDate }) {
  const a = useTaskActions()
  const [renaming, setRenaming] = useState(false)
  const notes = [t.checklist]
  if (!t.prazo) notes.push('sem prazo')
  const card = t.tipo === 'card' ? { ...t.card, nome: '' } : t.card
  const canEdit = editable(t)
  return (
    <li className={`feed-item no-time cal-item ${t.concluido ? 'done' : ''} ${canEdit ? 'editable' : ''}`}>
      <span className={`cal-item-check tone-${TONE[t.status]}`}><CheckButton t={t} /></span>
      <div className="feed-main">
        {renaming ? (
          <RenameInput value={t.titulo} onDone={(text) => { setRenaming(false); if (text !== null) a.rename(t, text) }} />
        ) : (
          <span className="feed-title">
            {t.tipo === 'card' && <span className="feed-kind card">Card</span>}
            <TaskOpen t={t} title="Abrir no editor" className="cal-title-open">{t.titulo}</TaskOpen>
          </span>
        )}
        {notes.some(Boolean) && <span className="feed-note">{notes.filter(Boolean).join(' · ')}</span>}
        <CardLink card={card} itemId={itemIdOf(t)} />
      </div>
      <div className="cal-side">
        <span className="cal-avatars">
          {t.responsaveis.slice(0, 3).map((p) => <span key={p.id} title={p.nome}><Avatar pessoa={p} size={22} /></span>)}
          {t.responsaveis.length > 3 && <span className="cal-plus">+{t.responsaveis.length - 3}</span>}
        </span>
        <Status status={t.status} date={showDate ? t.prazo : null} />
        {canEdit && <TaskMenu t={t} onRename={() => setRenaming(true)} />}
      </div>
    </li>
  )
}

const TONE = { concluido: 'good', atrasado: 'bad', hoje: 'amber', pendente: 'muted' }

function RenameInput({ value, onDone }) {
  const [text, setText] = useState(value)
  const ref = useRef(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const finish = (v) => { if (!done.current) { done.current = true; onDone(v) } }
  return (
    <textarea ref={ref} className="cal-rename" rows={Math.min(4, Math.ceil(text.length / 90) || 1)} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={() => finish(text)} aria-label="Novo título"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(text) }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null) }
      }} />
  )
}

// Menu da tarefa: reagendar, renomear, editar, tirar a data, excluir/arquivar.
function TaskMenu({ t, onRename }) {
  const a = useTaskActions()
  const { openCard } = useCardEditor()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) { setConfirm(false); return undefined }
    const off = (ev) => { if (ref.current && !ref.current.contains(ev.target)) setOpen(false) }
    const esc = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const go = (fn) => { setOpen(false); fn() }
  return (
    <span className="dropdown cal-menu" ref={ref}>
      <button type="button" className="btn btn-ghost btn-icon cal-menu-btn" aria-label="Ações da tarefa" title="Reagendar, renomear, excluir…"
        aria-expanded={open} onClick={(e) => {
          // Perto do rodapé o menu abre para cima.
          setUp(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom < 440)
          setOpen(!open)
        }}>
        <Icon name="more" />
      </button>
      {open && (
        <div className={`dropdown-menu resched-menu cal-menu-pop ${up ? 'up' : ''}`} role="menu">
          <p className="export-title">Mover para</p>
          {dateShortcuts(toIso(new Date())).map((s) => (
            <button key={s.key} type="button" role="menuitem" disabled={s.date === t.prazo}
              onClick={() => go(() => a.reschedule(t, s.date))}>
              <Icon name="calendar" />{s.label}<small>{shortDate(s.date)}</small>
            </button>
          ))}
          <label className="resched-date">
            <span>Outra data</span>
            <input type="date" defaultValue={t.prazo || ''} onChange={(ev) => ev.target.value && go(() => a.reschedule(t, ev.target.value))} />
          </label>
          <hr />
          <button type="button" role="menuitem" onClick={() => go(() => a.toggleDone(t))}>
            <Icon name={t.concluido ? 'circle' : 'check'} />{t.concluido ? 'Reabrir' : 'Marcar como concluída'}
          </button>
          <button type="button" role="menuitem" onClick={() => go(onRename)}><Icon name="edit" />Renomear</button>
          {openCard && (
            <button type="button" role="menuitem" onClick={() => go(() => openCard(t.card.id, { itemId: itemIdOf(t) }))}>
              <Icon name="external" />Abrir no editor<small>tudo</small>
            </button>
          )}
          {t.prazo && <button type="button" role="menuitem" onClick={() => go(() => a.clearDate(t))}><Icon name="undated" />Remover data</button>}
          <hr />
          {t.tipo === 'card' ? (
            <button type="button" role="menuitem" className="cal-danger" onClick={() => go(() => a.remove(t))}>
              <Icon name="archive" />Arquivar card
            </button>
          ) : confirm ? (
            <button type="button" role="menuitem" className="cal-danger confirm" autoFocus onClick={() => go(() => a.remove(t))}>
              <Icon name="trash" />Confirmar exclusão
            </button>
          ) : (
            <button type="button" role="menuitem" className="cal-danger" onClick={() => setConfirm(true)}>
              <Icon name="trash" />Excluir item
            </button>
          )}
        </div>
      )}
    </span>
  )
}

function Legend() {
  return (
    <div className="cal-legend">
      <span><span className="cal-check s-pendente"><Icon name="circle" /></span>Item pendente</span>
      <span><span className="cal-check s-concluido"><Icon name="checkCircle" /></span>Item concluído</span>
      <span><span className="cal-check s-pendente"><Icon name="square" /></span>Card</span>
      <span><span className="cal-check s-atrasado"><Icon name="circle" /></span>Atrasada</span>
      <span><span className="cal-check s-hoje"><Icon name="circle" /></span>Vence hoje</span>
      <span className="cal-legend-tip">Clique no ícone para concluir · arraste para outro dia para reagendar · <kbd>N</kbd> cria tarefa</span>
    </div>
  )
}
