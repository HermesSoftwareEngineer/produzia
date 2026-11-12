import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { boardsQuery } from '../api.js'
import { useBoards } from '../boards.jsx'
import { Avatar, CardLink, Empty, ErrorBox, Icon, Loading, Status, Warnings } from '../components/ui.jsx'
import {
  MODES, TYPES, VIEWS, WEEKDAYS, dayCounts, filterTasks, groupByDay, periodTitle, shiftDate, sortTasks, viewDays,
} from '../calendario.js'
import { addDays, fmt, parseDay, shortDate, toIso } from '../format.js'
import { useFetch } from '../useFetch.js'

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
  const [params, setParams] = useSearchParams()
  const today = toIso(new Date())
  const vista = VIEWS.some((v) => v.key === params.get('vista')) ? params.get('vista') : 'mes'
  const rawDate = params.get('data')
  const data = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(parseDay(rawDate).getTime()) ? rawDate : today
  const modo = params.get('modo') === 'conclusao' ? 'conclusao' : 'prazo'

  const [pessoa, setPessoa] = useState('')
  const [tipo, setTipo] = useState('ambos')
  const [mostrarConcluidas, setMostrarConcluidas] = useState(true)
  const compact = useMediaQuery('(max-width: 700px)')

  const go = (next, { push = false } = {}) => {
    const v = next.vista ?? vista
    const d = next.data ?? data
    const m = next.modo ?? modo
    setParams({ vista: v, data: d, ...(m === 'conclusao' ? { modo: m } : {}) }, { replace: !push })
  }
  const move = (dir) => go({ data: shiftDate(vista, data, dir) })
  const openDay = (iso) => go({ vista: 'dia', data: iso }, { push: true })

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowLeft') move(-1)
      if (e.key === 'ArrowRight') move(1)
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

  const filtros = { pessoa, tipo, mostrarConcluidas, modo }
  const visible = useMemo(() => (res ? filterTasks(res.tarefas, filtros) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [res, pessoa, tipo, mostrarConcluidas, modo])
  const byDay = useMemo(() => groupByDay(visible, modo), [visible, modo])

  if (loaded && !boards.length) {
    return <Empty title="Nenhum quadro cadastrado">Cadastre um quadro em <Link to="/quadros">Quadros</Link> para ver o calendário.</Empty>
  }

  const inView = days.flatMap((d) => byDay.get(d) || [])
  const counts = dayCounts(inView)
  const semConclusao = modo === 'conclusao' && res
    ? filterTasks(res.tarefas, { ...filtros, modo: 'prazo', mostrarConcluidas: true })
      .filter((t) => t.concluido && !t.concluidoEm && t.prazo >= inicio && t.prazo <= fim).length
    : 0
  // O mês conta como atual pelo mês, não pelos dias vizinhos que completam a grade.
  const current = vista === 'mes' ? today.slice(0, 7) === data.slice(0, 7) : days.includes(today)
  const atrasadas = vista === 'dia' && data === hoje && modo === 'prazo' && res
    ? sortTasks(filterTasks(res.atrasadas, { ...filtros, mostrarConcluidas: true }).filter((t) => t.prazo < data))
    : []

  return (
    <div className="page cal-page">
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
        </div>
      </div>

      <div className="cal-toolbar">
        <div className="segmented" role="group" aria-label="Posicionar tarefas">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={modo === m.key ? 'active' : ''} onClick={() => go({ modo: m.key })}>{m.label}</button>
          ))}
        </div>
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
        <label className="toggle" title={modo === 'conclusao' ? 'Por conclusão mostra só as concluídas' : undefined}>
          <input type="checkbox" checked={modo === 'conclusao' || mostrarConcluidas} disabled={modo === 'conclusao'}
            onChange={(e) => setMostrarConcluidas(e.target.checked)} />
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
      {semConclusao > 0 && (
        <p className="gt-note">
          <Icon name="card" />
          {semConclusao === 1 ? '1 card concluído fica' : `${fmt(semConclusao)} cards concluídos ficam`} de fora:
          o Trello não informa quando cards são concluídos, só itens de checklist.
        </p>
      )}

      {loading && !res ? <Loading /> : res && (
        <div className={`cal-body ${stale ? 'cal-stale' : ''}`}>
          {vista === 'mes' && (compact
            ? <MonthList days={days} month={data.slice(0, 7)} byDay={byDay} hoje={hoje} onPick={openDay} />
            : <MonthGrid days={days} month={data.slice(0, 7)} byDay={byDay} hoje={hoje} onPick={openDay} />)}
          {vista === 'semana' && <WeekView days={days} byDay={byDay} hoje={hoje} onPick={openDay} />}
          {vista === 'dia' && (
            <DayView day={data} list={byDay.get(data) || []} hoje={hoje} modo={modo} atrasadas={atrasadas} />
          )}
          {vista !== 'dia' && !inView.length && !stale && (
            <p className="feed-empty cal-empty">
              {modo === 'prazo' ? 'Nenhuma tarefa com prazo neste período.' : 'Nada concluído neste período.'}
            </p>
          )}
          {vista !== 'dia' && <Legend />}
        </div>
      )}
    </div>
  )
}

function TaskIcon({ t }) {
  const name = t.concluido ? (t.tipo === 'card' ? 'item' : 'checkCircle') : t.tipo === 'card' ? 'square' : 'circle'
  return <span className={`cal-check s-${t.status}`}><Icon name={name} /></span>
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

function MonthGrid({ days, month, byDay, hoje, onPick }) {
  return (
    <div className="cal-month" role="grid">
      {WEEKDAYS.map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
      {days.map((d) => {
        const list = byDay.get(d) || []
        const extra = list.length - MONTH_LIMIT
        const cls = ['cal-cell', d.slice(0, 7) !== month && 'out', d === hoje && 'today', d < hoje && 'past'].filter(Boolean).join(' ')
        return (
          <button key={d} type="button" className={cls} role="gridcell" onClick={() => onPick(d)}
            title={`Abrir ${shortDate(d)}`}>
            <span className="cal-cell-head">
              <span className="cal-date">{Number(d.slice(8))}</span>
              <Ratio list={list} />
            </span>
            <ul className="cal-minis">
              {list.slice(0, extra > 0 ? MONTH_LIMIT - 1 : MONTH_LIMIT).map((t) => (
                <li key={t.id} className={`cal-mini ${t.concluido ? 'done' : ''}`} title={tip(t)}>
                  <TaskIcon t={t} /><span className="truncate">{t.titulo}</span>
                </li>
              ))}
              {extra > 0 && <li className="cal-more">+{extra + 1} mais</li>}
            </ul>
          </button>
        )
      })}
    </div>
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
  const date = parseDay(day)
  return (
    <section className={`cal-col ${day === hoje ? 'today' : ''} ${listMode ? 'as-list' : ''}`}>
      <button type="button" className="cal-col-head" onClick={() => onPick(day)} title="Abrir o dia">
        <span className="cal-col-wd">{WEEKDAY_SHORT.format(date).replace('.', '')}</span>
        <span className="cal-col-date">{date.getDate()}</span>
        {listMode && <span className="cal-col-month">{shortDate(day)}</span>}
        <Ratio list={list} />
      </button>
      {list.length ? (
        <ul className="cal-col-list">
          {list.map((t) => (
            <li key={t.id} className={`cal-line ${t.concluido ? 'done' : ''}`}>
              <TaskIcon t={t} />
              <a href={t.card.url} target="_blank" rel="noreferrer" title={tip(t)}>
                <span className="cal-line-title">{t.titulo}</span>
                <span className="cal-line-meta">{t.tipo === 'card' ? `Card · ${t.card.quadro}` : t.card.nome}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="cal-col-empty">—</p>}
    </section>
  )
}

function DayView({ day, list, hoje, modo, atrasadas }) {
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
        </div>
      </div>

      {atrasadas.length > 0 && (
        <details className="cal-overdue" open={atrasadas.length <= 5}>
          <summary>
            <Icon name="chevron" className="caret" />
            Atrasadas de dias anteriores<span className="n">{atrasadas.length}</span>
          </summary>
          <ul className="feed">{atrasadas.map((t) => <DayItem key={t.id} t={t} modo={modo} showDate />)}</ul>
        </details>
      )}

      {modo === 'prazo' && (
        <>
          <div className={`feed-group ${late ? 'late' : ''}`}>Pendentes · {pendentes.length}</div>
          {pendentes.length
            ? <ul className="feed">{pendentes.map((t) => <DayItem key={t.id} t={t} modo={modo} />)}</ul>
            : <p className="feed-empty">{day === hoje ? 'Nada pendente para hoje.' : 'Nenhuma pendência com prazo neste dia.'}</p>}
        </>
      )}
      <div className="feed-group">Concluídas · {concluidas.length}</div>
      {concluidas.length
        ? <ul className="feed">{concluidas.map((t) => <DayItem key={t.id} t={t} modo={modo} />)}</ul>
        : <p className="feed-empty">{modo === 'prazo' ? 'Nada concluído entre as tarefas deste dia.' : 'Nada concluído neste dia.'}</p>}
    </div>
  )
}

const TONE = { concluido: 'good', atrasado: 'bad', hoje: 'amber', pendente: 'muted' }

function DayItem({ t, modo, showDate }) {
  const icon = t.tipo === 'card' ? 'card' : t.concluido ? 'check' : 'circle'
  const notes = [t.checklist]
  if (modo === 'prazo' && t.concluidoEm && t.concluidoEm !== t.prazo) notes.push(`concluída em ${shortDate(t.concluidoEm)}`)
  if (modo === 'conclusao' && t.prazo) notes.push(`prazo ${shortDate(t.prazo)}`)
  const card = t.tipo === 'card' ? { ...t.card, nome: '' } : t.card
  return (
    <li className="feed-item no-time cal-item">
      <span className={`feed-icon tone-${TONE[t.status]}`}><Icon name={icon} /></span>
      <div className="feed-main">
        <span className="feed-title">
          {t.tipo === 'card' && <span className="feed-kind card">Card</span>}
          {t.titulo}
        </span>
        {notes.some(Boolean) && <span className="feed-note">{notes.filter(Boolean).join(' · ')}</span>}
        <CardLink card={card} />
      </div>
      <div className="cal-side">
        <span className="cal-avatars">
          {t.responsaveis.slice(0, 3).map((p) => <span key={p.id} title={p.nome}><Avatar pessoa={p} size={22} /></span>)}
          {t.responsaveis.length > 3 && <span className="cal-plus">+{t.responsaveis.length - 3}</span>}
        </span>
        <Status status={t.status} date={showDate ? t.prazo : null} />
      </div>
    </li>
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
    </div>
  )
}
