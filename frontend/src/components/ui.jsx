import { delta, fmt, shortDate } from '../format.js'

const PATHS = {
  dashboard: 'M4 13h6V4H4zm0 7h6v-5H4zm10 0h6v-9h-6zm0-16v5h6V4z',
  calendar: 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 10h14v10H5zm2 3v2h4v-2z',
  board: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m2 3v11h4V6zm8 0v7h4V6z',
  logout: 'M10 17v-3H3v-4h7V7l5 5zm2-15h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-7v-2h7V4h-7z',
  refresh: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
  left: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z',
  right: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  circle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16',
  card: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 14H4V8h16z',
  comment: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  move: 'M16 13v-2H7V8l-4 4 4 4v-3zm4-9h-8v2h8v12h-8v2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  external: 'M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z',
  bars: 'M5 13h3v7H5zm5.5-5h3v12h-3zM16 4h3v16h-3z',
  warning: 'M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z',
  chevron: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z',
  moon: 'M12.3 2a10 10 0 1 0 9.7 12.6A8 8 0 0 1 12.3 2',
  monitor: 'M21 3H3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m0 13H3V5h18z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9',
}

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

const STATUS_LABEL = { atrasado: 'Atrasado', hoje: 'Vence no dia', andamento: 'Em andamento', prazo: 'No prazo' }

export function Status({ status, date }) {
  if (!status) return null
  return (
    <span className={`chip chip-${status}`}>
      {STATUS_LABEL[status]}{date ? ` · ${shortDate(date)}` : ''}
    </span>
  )
}

export function CardLink({ card, showBoard = true }) {
  const meta = [showBoard ? card.quadro : null, card.lista].filter(Boolean).join(' › ')
  return (
    <a className="card-link" href={card.url} target="_blank" rel="noreferrer" title="Abrir no Trello">
      <span className="card-link-name">{card.nome}</span>
      {meta && <span className="card-link-meta">{meta}</span>}
    </a>
  )
}
