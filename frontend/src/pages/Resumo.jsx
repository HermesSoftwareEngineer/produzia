import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { boardsQuery } from '../api.js'
import { useBoards } from '../boards.jsx'
import { Avatar, CardLink, Empty, ErrorBox, Icon, Loading, Status, Warnings } from '../components/ui.jsx'
import { addDays, fmt, longDate, toIso, weekday } from '../format.js'
import { useFetch } from '../useFetch.js'

export default function Resumo() {
  const { boards, loaded, selected, version } = useBoards()
  const [params, setParams] = useSearchParams()
  const today = toIso(new Date())
  const day = params.get('data') || today
  const [onlyActive, setOnlyActive] = useState(false)
  const [search, setSearch] = useState('')

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
    return data.pessoas.filter((p) => {
      if (onlyActive && !p.atividade) return false
      return !term || p.pessoa.nome.toLowerCase().includes(term) || (p.pessoa.username || '').includes(term)
    })
  }, [data, onlyActive, search])

  if (loaded && !boards.length) {
    return <Empty title="Nenhum quadro cadastrado">Cadastre um quadro em <Link to="/quadros">Quadros</Link> para ver o resumo.</Empty>
  }

  const t = data?.totais
  return (
    <div className="page">
      <div className="day-nav">
        <button className="btn btn-ghost btn-icon" type="button" onClick={() => setDay(addDays(day, -1))} title="Dia anterior (←)">
          <Icon name="left" />
        </button>
        <div className="day-picker">
          <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <div className="day-label">
            <strong>{longDate(day)}</strong>
            <span>{day === today ? 'Hoje' : day === addDays(today, -1) ? 'Ontem' : weekday(day)}</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-icon" type="button" onClick={() => setDay(addDays(day, 1))}
          disabled={day >= today} title="Próximo dia (→)">
          <Icon name="right" />
        </button>
        {day !== today && <button className="btn btn-ghost" type="button" onClick={() => setDay(today)}>Hoje</button>}
      </div>

      <ErrorBox error={error} />
      {data && <Warnings items={data.avisos} />}

      {t && (
        <div className="totals-strip">
          <Total icon="check" label="Itens concluídos" value={t.itensConcluidos} tone="good" />
          <Total icon="card" label="Cards concluídos" value={t.cardsConcluidos} tone="good" />
          <Total icon="comment" label="Comentários" value={t.comentarios} />
          <Total icon="plus" label="Cards criados" value={t.cardsCriados} />
          <Total icon="circle" label="Itens pendentes" value={t.itensPendentes} sub={t.itensAtrasados ? `${fmt(t.itensAtrasados)} atrasados` : null} />
          <Total icon="card" label="Cards pendentes" value={t.cardsPendentes} sub={t.cardsAtrasados ? `${fmt(t.cardsAtrasados)} atrasados` : null} />
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input placeholder="Filtrar pessoa…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="toggle">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          <span>Só quem teve atividade no dia</span>
        </label>
        {loading && data && <span className="muted small"><span className="spinner sm" /> Atualizando…</span>}
      </div>

      {loading && !data ? <Loading /> : (
        <div className="people-grid">
          {people.map((p) => <PersonCard key={p.pessoa.id} row={p} />)}
          {data && !people.length && <Empty title="Ninguém por aqui">Nenhuma pessoa com dados para esse filtro.</Empty>}
        </div>
      )}
    </div>
  )
}

function Total({ icon, label, value, sub, tone }) {
  return (
    <div className={`total ${tone ? `total-${tone}` : ''}`}>
      <Icon name={icon} />
      <div>
        <strong>{fmt(value)}</strong>
        <span>{label}</span>
        {sub && <em>{sub}</em>}
      </div>
    </div>
  )
}

function PersonCard({ row }) {
  const { pessoa, totais: t } = row
  const others = t.cardsCriados + t.movimentacoes
  return (
    <article className="person">
      <header className="person-head">
        <Avatar pessoa={pessoa} size={44} />
        <div className="person-name">
          <strong>{pessoa.nome}</strong>
          {pessoa.username && <span>@{pessoa.username}</span>}
        </div>
        {row.atividade === 0 && <span className="chip chip-idle">Sem atividade</span>}
      </header>

      <div className="person-stats">
        <Stat value={t.itensConcluidos} label="itens feitos" tone="good" />
        <Stat value={t.cardsConcluidos} label="cards concluídos" tone="good" />
        <Stat value={t.comentarios} label="comentários" />
        <Stat value={t.itensPendentes} label="itens pendentes" tone={t.itensAtrasados ? 'bad' : undefined}
          hint={t.itensAtrasados ? `${t.itensAtrasados} atrasados` : undefined} />
        <Stat value={t.cardsPendentes} label="cards pendentes" tone={t.cardsAtrasados ? 'bad' : undefined}
          hint={t.cardsAtrasados ? `${t.cardsAtrasados} atrasados` : undefined} />
      </div>

      <Section title="Itens de checklist concluídos" count={t.itensConcluidos} open tone="good">
        {row.itensConcluidos.map((i, n) => (
          <li key={n} className="entry">
            <Icon name="check" className="entry-icon good" />
            <div className="entry-body">
              <span className="entry-text">{i.texto}</span>
              <CardLink card={i.card} />
              {i.concluidoPor && <span className="entry-note">marcado por {i.concluidoPor}</span>}
            </div>
            <time>{i.hora}</time>
          </li>
        ))}
      </Section>

      <Section title="Cards concluídos" count={t.cardsConcluidos} open tone="good">
        {row.cardsConcluidos.map((c, n) => (
          <li key={n} className="entry">
            <Icon name="card" className="entry-icon good" />
            <div className="entry-body">
              <CardLink card={c.card} />
              <span className="entry-note">{c.via}</span>
            </div>
            <time>{c.hora}</time>
          </li>
        ))}
      </Section>

      <Section title="Comentários" count={t.comentarios} open={t.comentarios <= 3}>
        {row.comentarios.map((c, n) => (
          <li key={n} className="entry">
            <Icon name="comment" className="entry-icon" />
            <div className="entry-body">
              <CardLink card={c.card} />
              <p className="comment">{c.texto}</p>
            </div>
            <time>{c.hora}</time>
          </li>
        ))}
      </Section>

      <Section title="Itens pendentes" count={t.itensPendentes} badge={t.itensAtrasados ? `${t.itensAtrasados} atrasados` : null}>
        {row.itensPendentes.map((i, n) => (
          <li key={n} className="entry">
            <Icon name="circle" className="entry-icon muted" />
            <div className="entry-body">
              <span className="entry-text">{i.texto}</span>
              <CardLink card={i.card} />
            </div>
            <Status status={i.status} date={i.dataFim} />
          </li>
        ))}
      </Section>

      <Section title="Cards pendentes" count={t.cardsPendentes} badge={t.cardsAtrasados ? `${t.cardsAtrasados} atrasados` : null}>
        {row.cardsPendentes.map((c, n) => (
          <li key={n} className="entry">
            <Icon name="card" className="entry-icon muted" />
            <div className="entry-body"><CardLink card={c.card} /></div>
            <Status status={c.status} date={c.due} />
          </li>
        ))}
      </Section>

      <Section title="Outras atividades" count={others}>
        {row.cardsCriados.map((c, n) => (
          <li key={`c${n}`} className="entry">
            <Icon name="plus" className="entry-icon" />
            <div className="entry-body">
              <CardLink card={c.card} />
              <span className="entry-note">criou o card{c.lista ? ` em ${c.lista}` : ''}</span>
            </div>
            <time>{c.hora}</time>
          </li>
        ))}
        {row.movimentacoes.map((m, n) => (
          <li key={`m${n}`} className="entry">
            <Icon name="move" className="entry-icon" />
            <div className="entry-body">
              <CardLink card={m.card} />
              <span className="entry-note">moveu de {m.de} para {m.para}</span>
            </div>
            <time>{m.hora}</time>
          </li>
        ))}
      </Section>
    </article>
  )
}

function Stat({ value, label, tone, hint }) {
  return (
    <div className={`stat ${value && tone ? `stat-${tone}` : ''} ${!value ? 'stat-zero' : ''}`} title={hint}>
      <strong>{fmt(value)}</strong>
      <span>{label}</span>
    </div>
  )
}

function Section({ title, count, open = false, badge, tone, children }) {
  if (!count) return null
  return (
    <details className={`section ${tone ? `section-${tone}` : ''}`} open={open}>
      <summary>
        <Icon name="chevron" className="caret" />
        <span>{title}</span>
        <span className="count">{fmt(count)}</span>
        {badge && <span className="chip chip-atrasado">{badge}</span>}
      </summary>
      <ul className="entries">{children}</ul>
    </details>
  )
}
