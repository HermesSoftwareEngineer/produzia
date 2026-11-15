import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { boardsQuery } from '../api.js'
import { useBoards } from '../boards.jsx'
import { useCardEditor } from '../components/editorContext.js'
import { useToast } from '../components/Toasts.jsx'
import { Avatar, CardLink, Empty, ErrorBox, Icon, Status, Warnings } from '../components/ui.jsx'
import { completeTask, dateShortcuts, rescheduleTask, runQueue, typing } from '../edit.js'
import { addDays, fmt, longDate, shortDate, toIso, weekday } from '../format.js'
import { PDF_SECTIONS, buildFeeds, dueDay, pendingGroups } from '../resumo.js'
import { useFetch } from '../useFetch.js'

// Seleção e ações em lote das pendências (compartilhado pelas pessoas da página).
const PendingContext = createContext(null)

export default function Resumo() {
  const { boards, loaded, selected, version } = useBoards()
  const [params, setParams] = useSearchParams()
  const today = toIso(new Date())
  const day = params.get('data') || today
  const [onlyActive, setOnlyActive] = useState(false)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const pending = usePendingActions(today)

  const setDay = (iso) => setParams(iso === today ? {} : { data: iso }, { replace: true })
  const q = [`data=${day}`, boardsQuery(selected)].filter(Boolean).join('&')
  const { data, error, loading } = useFetch(boards.length ? `/resumo?${q}` : null, [q, version, boards.length])
  // Dados novos do servidor: o que estava escondido de forma otimista já vem certo.
  const { resetHidden } = pending
  useEffect(() => { if (!pending.running) resetHidden() }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (typing(e) || e.defaultPrevented || document.querySelector('.cd-overlay')) return
      if (e.key === 'ArrowLeft') setDay(addDays(day, -1))
      if (e.key === 'ArrowRight' && day < today) setDay(addDays(day, 1))
      if (e.key === 'Escape' && pending.sel.size && !pending.running) pending.clear()
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

      {pending.result?.falhas.length > 0 && <BatchFailures result={pending.result} onClose={pending.dismissResult} />}

      {loading && !data ? <ResumoSkeleton /> : (
        <PendingContext.Provider value={pending}>
          <div className="rs-list">
            {people.map((p) => (
              <Person key={p.pessoa.id} row={p} open={open.has(p.pessoa.id)} onToggle={() => toggle(p.pessoa.id)} />
            ))}
            {data && !people.length && <Empty title="Ninguém por aqui">Nenhuma pessoa com dados para esse filtro.</Empty>}
          </div>
        </PendingContext.Provider>
      )}
      <BatchBar pending={pending} />
    </div>
  )
}

function ResumoSkeleton() {
  return (
    <div className="rs-list" aria-busy="true" aria-label="Buscando dados no Trello">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rs-person sk-person">
          <span className="sk sk-avatar" /><span className="sk sk-line" /><span className="sk sk-line short" />
        </div>
      ))}
    </div>
  )
}

const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`
const RESCHEDULE = { doing: 'Reagendando', one: 'reagendado', many: 'reagendados' }
const COMPLETE = { doing: 'Concluindo', one: 'concluído', many: 'concluídos' }

// Seleção e execução das ações (reagendar, adiar, concluir): uma chamada por vez, com progresso,
// resumo do que deu certo e do que falhou, e "Desfazer" logo depois.
function usePendingActions(today) {
  const { refresh } = useBoards()
  const { toast } = useToast()
  const [sel, setSel] = useState(() => new Map()) // key -> pendência
  const [hidden, setHidden] = useState(() => new Set())
  const [progress, setProgress] = useState(null) // { label, done, total }
  const [result, setResult] = useState(null)

  const running = Boolean(progress)
  const toggle = (e) => setSel((prev) => {
    const next = new Map(prev)
    if (next.has(e.key)) next.delete(e.key)
    else next.set(e.key, e)
    return next
  })
  const setMany = (list, on) => setSel((prev) => {
    const next = new Map(prev)
    list.forEach((e) => (on ? next.set(e.key, e) : next.delete(e.key)))
    return next
  })
  const clear = () => setSel(new Map())

  async function execute(tasks, { verb, skipped = [] }) {
    if (running || (!tasks.length && !skipped.length)) return
    const keys = tasks.map((t) => t.e.key)
    setHidden((h) => new Set([...h, ...keys])) // some da lista na hora; volta se falhar
    setResult(null)
    setProgress({ label: verb.doing, done: 0, total: tasks.length })
    const { ok, falhas } = await runQueue(tasks, { onProgress: (done, total) => setProgress({ label: verb.doing, done, total }) })
    const allFails = [...skipped, ...falhas]
    setHidden((h) => {
      const next = new Set(h)
      falhas.forEach((f) => next.delete(f.task.e.key))
      return next
    })
    setProgress(null)
    clear()
    setResult({ verb, ok: ok.length, falhas: allFails })
    if (ok.length) refresh()
    toast({
      tone: allFails.length ? (ok.length ? 'info' : 'bad') : 'good',
      text: [ok.length && plural(ok.length, verb.one, verb.many), allFails.length && plural(allFails.length, 'falhou', 'falharam')]
        .filter(Boolean).join(' · '),
      action: ok.length ? { label: 'Desfazer', onClick: () => undoAll(ok, verb) } : undefined,
      duration: 10000,
    })
  }

  async function undoAll(ok, verb) {
    const tasks = ok.map(({ task, result: res }) => ({ e: task.e, run: () => task.undo(res) }))
    setProgress({ label: 'Desfazendo', done: 0, total: tasks.length })
    const { falhas } = await runQueue(tasks, { onProgress: (done, total) => setProgress({ label: 'Desfazendo', done, total }) })
    setProgress(null)
    setHidden(new Set())
    refresh()
    setResult(falhas.length ? { verb: { ...verb, one: 'desfeito', many: 'desfeitos' }, ok: tasks.length - falhas.length, falhas } : null)
    toast({
      tone: falhas.length ? 'bad' : 'good',
      text: falhas.length ? `${plural(falhas.length, 'alteração não pôde', 'alterações não puderam')} ser desfeitas.` : 'Alterações desfeitas.',
    })
  }

  const reschedule = (list, date) => execute(list.map((e) => rescheduleTask(e, date)), { verb: RESCHEDULE })
  const postpone = (list, days) => {
    const withDue = list.filter((e) => dueDay(e))
    const skipped = list.filter((e) => !dueDay(e)).map((e) => ({ task: { e }, erro: 'Sem prazo para adiar.' }))
    return execute(withDue.map((e) => rescheduleTask(e, addDays(dueDay(e), days))), { verb: RESCHEDULE, skipped })
  }
  const complete = (list) => execute(list.map(completeTask), { verb: COMPLETE })

  return {
    sel, hidden, running, progress, result, today, toggle, setMany, clear,
    reschedule, postpone, complete, dismissResult: () => setResult(null), resetHidden: () => setHidden(new Set()),
  }
}

function BatchBar({ pending }) {
  const [date, setDate] = useState(() => addDays(pending.today, 1))
  const [days, setDays] = useState(7)
  const list = [...pending.sel.values()]
  const { progress } = pending
  const show = list.length > 0 || Boolean(progress)
  return (
    <div className={`batch-bar ${show ? 'show' : ''}`} role="toolbar" aria-label="Ações nos selecionados" aria-hidden={!show}>
      {progress ? (
        <div className="batch-progress" role="status">
          <span className="spinner sm" />
          <span>{progress.label} {fmt(progress.done)} de {fmt(progress.total)}…</span>
          <div className="bar"><span style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
        </div>
      ) : (
        <>
          <strong className="batch-count">{plural(list.length, 'selecionado', 'selecionados')}</strong>
          <span className="batch-group">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Nova data" tabIndex={show ? 0 : -1} />
            <button className="btn btn-primary" type="button" disabled={!date} tabIndex={show ? 0 : -1}
              onClick={() => pending.reschedule(list, date)}>
              <Icon name="calendar" />Reagendar
            </button>
          </span>
          <span className="batch-group">
            <span className="batch-label">Adiar</span>
            <input type="number" min={1} max={365} value={days} aria-label="Dias para adiar" tabIndex={show ? 0 : -1}
              onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
            <button className="btn btn-ghost" type="button" tabIndex={show ? 0 : -1}
              title="Soma os dias ao prazo de cada um (mantém a diferença entre eles)"
              onClick={() => pending.postpone(list, days)}>
              dias
            </button>
          </span>
          <button className="btn btn-ghost" type="button" tabIndex={show ? 0 : -1} onClick={() => pending.complete(list)}>
            <Icon name="check" />Concluir
          </button>
          <button className="link-btn" type="button" tabIndex={show ? 0 : -1} onClick={pending.clear} title="Limpar seleção (Esc)">Limpar</button>
        </>
      )}
    </div>
  )
}

function BatchFailures({ result, onClose }) {
  return (
    <div className="alert alert-error batch-result">
      <Icon name="warning" />
      <div>
        <strong>
          {result.ok > 0 && `${plural(result.ok, result.verb.one, result.verb.many)}. `}
          {plural(result.falhas.length, 'não deu certo', 'não deram certo')}:
        </strong>
        <ul>{result.falhas.map((f) => <li key={f.task.e.key}><b>{f.task.e.titulo}</b> — {f.erro}</li>)}</ul>
      </div>
      <button className="btn btn-ghost btn-icon" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" /></button>
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
  const pending = useContext(PendingContext)
  const shown = items.filter((e) => !pending.hidden.has(e.key))
  if (!shown.length) return <p className="feed-empty">{items.length ? 'Tudo reagendado ou concluído.' : 'Nenhuma pendência.'}</p>
  return (
    <ul className="feed">
      {pendingGroups(shown).map((g) => {
        const editable = g.items.filter((e) => !e.card.arquivado)
        const all = editable.length > 0 && editable.every((e) => pending.sel.has(e.key))
        const some = editable.some((e) => pending.sel.has(e.key))
        return (
          <li key={g.key}>
            <div className={`feed-group ${g.key === 'atrasado' ? 'late' : ''}`}>
              {editable.length > 0 && (
                <input type="checkbox" className="feed-check" checked={all} disabled={pending.running}
                  ref={(el) => { if (el) el.indeterminate = some && !all }}
                  aria-label={`Selecionar todos: ${g.label}`} title="Selecionar todos do grupo"
                  onChange={() => pending.setMany(editable, !all)} />
              )}
              {g.label} · {g.items.length}
            </div>
            <ul className="feed">{g.items.map((e) => <FeedItem key={e.key} e={e} grouped selectable />)}</ul>
          </li>
        )
      })}
    </ul>
  )
}

function FeedItem({ e, grouped, selectable }) {
  const pending = useContext(PendingContext)
  const { openCard } = useCardEditor()
  const canEdit = Boolean(selectable && pending && !e.card?.arquivado)
  const checked = canEdit && pending.sel.has(e.key)
  const icon = <span className={`feed-icon tone-${e.tom || 'muted'}`}><Icon name={e.icone || 'circle'} /></span>
  return (
    <li className={`feed-item ${grouped ? 'no-time' : ''} ${canEdit ? 'selectable' : ''} ${checked ? 'selected' : ''}`}>
      {canEdit
        ? (
          <span className="feed-select">
            <input type="checkbox" className="feed-check" checked={checked} disabled={pending.running}
              aria-label={`Selecionar ${e.titulo}`} onChange={() => pending.toggle(e)} />
            {icon}
          </span>
        )
        : icon}
      <div className="feed-main">
        <span className="feed-title">
          {canEdit && openCard
            ? <button type="button" className="feed-open" title="Abrir no Produzia" onClick={() => openCard(e.cardId, { itemId: e.itemId })}>{e.titulo}</button>
            : e.titulo}
        </span>
        {e.citacao && <p className="feed-quote">{e.citacao}</p>}
        {e.nota && <span className="feed-note">{e.nota}</span>}
        {e.card && <CardLink card={e.card} itemId={e.itemId} />}
      </div>
      {!grouped && <time>{e.hora || ''}</time>}
      {grouped
        ? (
          <span className="feed-side">
            <span className={`feed-due ${e.status === 'atrasado' ? 'late' : ''}`}>{e.prazo ? `prazo ${shortDate(e.prazo)}` : ''}</span>
            {canEdit && <RescheduleMenu e={e} />}
          </span>
        )
        : <span>{e.status && <Status status={e.status} date={e.prazo} />}</span>}
    </li>
  )
}

// Reagendar uma pendência: atalhos, data escolhida ou concluir.
function RescheduleMenu({ e }) {
  const pending = useContext(PendingContext)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = (ev) => { if (ref.current && !ref.current.contains(ev.target)) setOpen(false) }
    const esc = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const go = (fn) => { setOpen(false); fn() }
  return (
    <span className="dropdown resched" ref={ref}>
      <button type="button" className="btn btn-ghost btn-icon resched-btn" disabled={pending.running}
        aria-label="Reagendar" title="Reagendar" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="clock" />
      </button>
      {open && (
        <div className="dropdown-menu resched-menu" role="menu">
          <p className="export-title">Reagendar para</p>
          {dateShortcuts(pending.today).map((s) => (
            <button key={s.key} type="button" role="menuitem" onClick={() => go(() => pending.reschedule([e], s.date))}>
              {s.label}<small>{shortDate(s.date)}</small>
            </button>
          ))}
          <label className="resched-date">
            <span>Outra data</span>
            <input type="date" onChange={(ev) => ev.target.value && go(() => pending.reschedule([e], ev.target.value))} />
          </label>
          <hr />
          <button type="button" role="menuitem" onClick={() => go(() => pending.complete([e]))}><Icon name="check" />Marcar como concluído</button>
        </div>
      )}
    </span>
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
