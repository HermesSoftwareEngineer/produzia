import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { boardsQuery } from '../api.js'
import { useBoards } from '../boards.jsx'
import { Avatar, CardLink, Empty, ErrorBox, Icon, Loading, Status, Warnings } from '../components/ui.jsx'
import { addDays, fmt, longDate, shortDate, toIso, weekday } from '../format.js'
import { PDF_SECTIONS, buildFeeds, pendingGroups } from '../resumo.js'
import { useFetch } from '../useFetch.js'

export default function Resumo() {
  const { boards, loaded, selected, version } = useBoards()
  const [params, setParams] = useSearchParams()
  const today = toIso(new Date())
  const day = params.get('data') || today
  const [onlyActive, setOnlyActive] = useState(false)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(() => new Set())

  const setDay = (iso) => setParams(iso === today ? {} : { data: iso }, { replace: true })
  const q = [`data=${day}`, boardsQuery(selected)].filter(Boolean).join('&')
  const { data, error, loading } = useFetch(boards.length ? `/resumo?${q}` : null, [q, version, boards.length])

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'ArrowLeft') setDay(addDays(day, -1))
      if (e.key === 'ArrowRight' && day < today) setDay(addDays(day, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const people = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    return data.pessoas
      .filter((p) => !onlyActive || p.atividade)
      .filter((p) => !term || p.pessoa.nome.toLowerCase().includes(term) || (p.pessoa.username || '').includes(term))
      .map((p) => ({ ...p, feeds: buildFeeds(p) }))
  }, [data, onlyActive, search])

  if (loaded && !boards.length) {
    return <Empty title="Nenhum quadro cadastrado">Cadastre um quadro em <Link to="/quadros">Quadros</Link> para ver o resumo.</Empty>
  }

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const allOpen = people.length > 0 && people.every((p) => open.has(p.pessoa.id))
  const boardsLabel = selected.length
    ? boards.filter((b) => selected.includes(b.id)).map((b) => b.nome).join(', ')
    : `Todos os quadros (${boards.length})`
  const relative = day === today ? 'Hoje' : day === addDays(today, -1) ? 'Ontem' : weekday(day)
  const t = data?.totais

  return (
    <div className="page rs">
      <div className="rs-head">
        <div className="day-nav">
          <button className="btn btn-ghost btn-icon" type="button" onClick={() => setDay(addDays(day, -1))} title="Dia anterior (←)">
            <Icon name="left" />
          </button>
          <label className="day-title" title="Escolher data">
            <strong>{longDate(day)}</strong>
            <span>{relative}</span>
            <input type="date" value={day} max={today} aria-label="Data do resumo"
              onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
          <button className="btn btn-ghost btn-icon" type="button" onClick={() => setDay(addDays(day, 1))}
            disabled={day >= today} title="Próximo dia (→)">
            <Icon name="right" />
          </button>
          {day !== today && <button className="today-link" type="button" onClick={() => setDay(today)}>Hoje</button>}
        </div>
        <div className="rs-actions">
          {loading && data && <span className="spinner sm" title="Atualizando" />}
          <ExportButton disabled={!data || loading} onExport={async (sections) => {
            const { exportResumoPdf } = await import('../pdf.js')
            exportResumoPdf({ data, people, day, boardsLabel, sections, filtered: Boolean(search.trim() || onlyActive) })
          }} />
        </div>
      </div>

      <ErrorBox error={error} />
      {data && <Warnings items={data.avisos} />}

      {t && (
        <div className="rs-summary">
          <Metric icon="item" value={t.itensConcluidos} label="itens de checklist feitos" good />
          <Metric icon="card" value={t.cardsConcluidos} label="cards concluídos" good />
          <Metric icon="comment" value={t.comentarios} label="comentários" />
          <Metric icon="circle" value={t.itensPendentes} label="itens pendentes" late={t.itensAtrasados} />
          <Metric icon="clock" value={t.cardsPendentes} label="cards pendentes" late={t.cardsAtrasados} />
        </div>
      )}

      <div className="rs-toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Buscar pessoa" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="toggle">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          <span>Só quem teve atividade</span>
        </label>
        {people.length > 0 && (
          <button className="link-btn" type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(people.map((p) => p.pessoa.id)))}>
            {allOpen ? 'Recolher todos' : 'Expandir todos'}
          </button>
        )}
      </div>

      {loading && !data ? <Loading /> : (
        <div className="rs-list">
          {people.map((p) => (
            <Person key={p.pessoa.id} row={p} open={open.has(p.pessoa.id)} onToggle={() => toggle(p.pessoa.id)} />
          ))}
          {data && !people.length && <Empty title="Ninguém por aqui">Nenhuma pessoa com dados para esse filtro.</Empty>}
        </div>
      )}
    </div>
  )
}

function Metric({ icon, value, label, good, late }) {
  return (
    <div className={`metric ${good && value ? 'metric-good' : ''}`}>
      <strong>{fmt(value)}</strong>
      <span className="metric-label"><Icon name={icon} />{label}</span>
      {late > 0 && <em>{fmt(late)} atrasados</em>}
    </div>
  )
}

function Person({ row, open, onToggle }) {
  const { pessoa, totais: t, feeds } = row
  const done = feeds.concluidos.length
  const pending = feeds.pendentes.length
  const late = t.itensAtrasados + t.cardsAtrasados
  const pct = done + pending ? Math.round((100 * done) / (done + pending)) : null

  return (
    <section className={`rs-person ${open ? 'open' : ''}`}>
      <button className="rs-row" type="button" onClick={onToggle} aria-expanded={open}>
        <div className="rs-who">
          <Avatar pessoa={pessoa} size={36} />
          <div className="truncate">
            <strong>{pessoa.nome}</strong>
            {row.atividade === 0 && <div className="idle">Sem atividade no dia</div>}
          </div>
        </div>
        <div className="rs-nums">
          <Num icon="check" value={done} label="feitos" good />
          <Num icon="clock" value={pending} label="pendentes" late={late > 0} hint={late ? `${late} atrasados` : undefined} />
          <Num icon="comment" value={t.comentarios} label="comentários" />
        </div>
        <div className="rs-progress" title="Concluídos sobre concluídos + pendentes">
          {pct !== null && <>
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
            <small>{pct}% do dia</small>
          </>}
        </div>
        <Icon name="chevron" className="caret" />
      </button>
      {open && <PersonDetail feeds={feeds} late={late} />}
    </section>
  )
}

function Num({ icon, value, label, good, late, hint }) {
  return (
    <span className={`rs-num ${!value ? 'zero' : good ? 'good' : ''}`} title={hint}>
      <Icon name={icon} /><b>{fmt(value)}</b>{label}{late && <i className="late-dot" />}
    </span>
  )
}

function PersonDetail({ feeds, late }) {
  const tabs = [
    { key: 'concluidos', icon: 'check', label: 'Concluídos', n: feeds.concluidos.length },
    { key: 'pendentes', icon: 'clock', label: 'Pendentes', n: feeds.pendentes.length, late },
    { key: 'comentarios', icon: 'comment', label: 'Comentários', n: feeds.comentarios.length },
    { key: 'atividade', icon: 'move', label: 'Outras atividades', n: feeds.atividade.length },
  ]
  const [tab, setTab] = useState(() => (tabs.find((x) => x.n) || tabs[0]).key)

  return (
    <div className="rs-detail">
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key}
            className={tab === x.key ? 'active' : ''} onClick={() => setTab(x.key)}>
            <Icon name={x.icon} />{x.label}<span className={`n ${x.late ? 'late' : ''}`}>{x.n}</span>
          </button>
        ))}
      </div>
      {tab === 'concluidos' && <Feed items={feeds.concluidos} empty="Nada concluído neste dia." />}
      {tab === 'pendentes' && <PendingFeed items={feeds.pendentes} />}
      {tab === 'comentarios' && <Feed items={feeds.comentarios} empty="Nenhum comentário neste dia." />}
      {tab === 'atividade' && <Feed items={feeds.atividade} empty="Nenhuma outra atividade." />}
    </div>
  )
}

function Feed({ items, empty }) {
  if (!items.length) return <p className="feed-empty">{empty}</p>
  return <ul className="feed">{items.map((e, i) => <FeedItem key={i} e={e} />)}</ul>
}

function PendingFeed({ items }) {
  if (!items.length) return <p className="feed-empty">Nenhuma pendência.</p>
  return (
    <ul className="feed">
      {pendingGroups(items).map((g) => (
        <li key={g.key}>
          <div className={`feed-group ${g.key === 'atrasado' ? 'late' : ''}`}>{g.label} · {g.items.length}</div>
          <ul className="feed">{g.items.map((e, i) => <FeedItem key={i} e={e} grouped />)}</ul>
        </li>
      ))}
    </ul>
  )
}

function FeedItem({ e, grouped }) {
  return (
    <li className={`feed-item ${grouped ? 'no-time' : ''}`}>
      <span className={`feed-icon tone-${e.tom || 'muted'}`}><Icon name={e.icone || 'circle'} /></span>
      <div className="feed-main">
        <span className="feed-title">
          {e.titulo}
        </span>
        {e.citacao && <p className="feed-quote">{e.citacao}</p>}
        {e.nota && <span className="feed-note">{e.nota}</span>}
        {e.card && <CardLink card={e.card} />}
      </div>
      {!grouped && <time>{e.hora || ''}</time>}
      {grouped
        ? <span className={`feed-due ${e.status === 'atrasado' ? 'late' : ''}`}>{e.prazo ? `prazo ${shortDate(e.prazo)}` : ''}</span>
        : <span>{e.status && <Status status={e.status} date={e.prazo} />}</span>}
    </li>
  )
}

function ExportButton({ disabled, onExport }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sections, setSections] = useState(() => Object.fromEntries(PDF_SECTIONS.map((s) => [s.key, true])))
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function run() {
    setBusy(true)
    try {
      await onExport(sections)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-ghost" type="button" disabled={disabled} onClick={() => setOpen(!open)}>
        <Icon name="download" />Exportar PDF
      </button>
      {open && (
        <div className="dropdown-menu export-menu">
          <p className="export-title">Incluir no relatório</p>
          {PDF_SECTIONS.map((s) => (
            <label className="check-row" key={s.key}>
              <input type="checkbox" checked={sections[s.key]}
                onChange={(e) => setSections({ ...sections, [s.key]: e.target.checked })} />
              <span>{s.label}</span>
            </label>
          ))}
          <button className="btn btn-primary btn-block" type="button" disabled={busy || !Object.values(sections).some(Boolean)} onClick={run}>
            {busy ? 'Gerando…' : 'Baixar PDF'}
          </button>
        </div>
      )}
    </div>
  )
}
