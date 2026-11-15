import { delta, fmt, shortDate } from '../format.js'
import { PATHS } from '../icons.js'
import { useCardEditor } from './editorContext.js'


export function Icon({ name, className = '' }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[name]} /></svg>
  )
}

export function Avatar({ pessoa, size = 36 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }
  if (pessoa.avatar) return <img className="avatar" style={style} src={pessoa.avatar} alt="" />
  return (
    <span className={`avatar avatar-fallback ${pessoa.id === '_sem' ? 'avatar-none' : ''}`} style={style}>
      {pessoa.iniciais}
    </span>
  )
}

export function Loading({ text = 'Buscando dados no Trello…' }) {
  return <div className="loading"><span className="spinner" />{text}</div>
}

export function ErrorBox({ error }) {
  if (!error) return null
  return <div className="alert alert-error"><Icon name="warning" /><span>{error.message}</span></div>
}

export function Warnings({ items }) {
  if (!items?.length) return null
  if (items.length === 1) {
    return <div className="alert alert-warn"><Icon name="warning" /><span>{items[0]}</span></div>
  }
  return (
    <details className="alert alert-warn">
      <summary><Icon name="warning" /><span>{items.length} avisos sobre os dados</span></summary>
      <ul>{items.map((w) => <li key={w}>{w}</li>)}</ul>
    </details>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function Kpi({ label, value, previous, suffix = '', tone, hint }) {
  const d = previous === undefined ? undefined : delta(value, previous)
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`} title={hint}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value === null || value === undefined ? '—' : `${fmt(value)}${suffix}`}</strong>
      {d !== undefined && (
        <span className={`kpi-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
          {d === null ? 'novo' : `${d > 0 ? '+' : ''}${d}%`}
          <em> vs. período anterior ({fmt(previous)})</em>
        </span>
      )}
    </div>
  )
}

const STATUS_LABEL = {
  atrasado: 'Atrasado', hoje: 'Vence no dia', andamento: 'Em andamento', prazo: 'No prazo',
  concluido: 'Concluído', pendente: 'Pendente',
}

export function Status({ status, date }) {
  if (!status) return null
  return (
    <span className={`chip chip-${status}`}>
      {STATUS_LABEL[status]}{date ? ` · ${shortDate(date)}` : ''}
    </span>
  )
}

// Link do card: abre o editor do Produzia (o Trello fica a um clique, dentro do editor).
// Card arquivado ou sem editor disponível continua indo direto para o Trello.
export function CardLink({ card, showBoard = true, itemId }) {
  const { openCard } = useCardEditor()
  const meta = [showBoard ? card.quadro : null, card.lista].filter(Boolean).join(' › ')
  const inner = <>
    {card.nome && <span className="card-link-name">{card.nome}</span>}
    {meta && <span className="card-link-meta">{meta}</span>}
  </>
  if (!openCard || card.arquivado) {
    return <a className="card-link" href={card.url} target="_blank" rel="noreferrer" title="Abrir no Trello">{inner}</a>
  }
  return (
    <button type="button" className="card-link card-link-btn" title="Abrir o card no Produzia"
      onClick={() => openCard(card.id, { itemId })}>
      {inner}
    </button>
  )
}
