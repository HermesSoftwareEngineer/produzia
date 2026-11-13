import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarController, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale,
  LineController, LineElement, PointElement, Tooltip,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { boardsQuery } from '../api.js'
import { useBoards } from '../boards.jsx'
import { Avatar, Empty, ErrorBox, Icon, Kpi, Loading, Warnings } from '../components/ui.jsx'
import { fmt, shortDate } from '../format.js'
import { useTheme } from '../theme.jsx'
import { useFetch } from '../useFetch.js'

ChartJS.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale,
  LinearScale, Tooltip, Legend, Filler)
ChartJS.defaults.font.family = 'Inter, system-ui, sans-serif'

const PERIODS = [7, 14, 30, 60, 90]
const PALETTE = {
  light: { itens: '#0d9488', cards: '#6366f1', comentarios: '#f59e0b', horas: '#5eead4', text: '#64748b', grid: '#eef2f7' },
  dark: { itens: '#2dd4bf', cards: '#818cf8', comentarios: '#fbbf24', horas: '#1f6f68', text: '#8b9aa3', grid: '#1c2830' },
}

function usePalette() {
  const { theme } = useTheme()
  const c = PALETTE[theme]
  return c
}

export default function Dashboard() {
  const { boards, loaded, selected, version } = useBoards()
  const [days, setDays] = useState(14)
  const q = [`dias=${days}`, boardsQuery(selected)].filter(Boolean).join('&')
  const { data, error, loading } = useFetch(boards.length ? `/dashboard?${q}` : null, [q, version, boards.length])

  if (loaded && !boards.length) {
    return (
      <Empty title="Comece cadastrando um quadro">
        Vá em <Link to="/quadros">Quadros</Link> e adicione os quadros do Trello que quer acompanhar.
      </Empty>
    )
  }

  return (
    <div className="page">
      <div className="toolbar">
        <div className="segmented">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={p === days ? 'active' : ''} onClick={() => setDays(p)}>{p} dias</button>
          ))}
        </div>
        {data && <span className="muted small">{shortDate(data.inicio)} a {shortDate(data.fim)}</span>}
        {loading && data && <span className="muted small"><span className="spinner sm" /> Atualizando…</span>}
      </div>

      <ErrorBox error={error} />
      {data && <Warnings items={data.avisos} />}
      {loading && !data ? <Loading /> : data && <DashboardBody data={data} />}
    </div>
  )
}

function DashboardBody({ data }) {
  const k = data.kpis
  const prev = k.anterior
  return (
    <>
      <section className="kpi-grid">
        <Kpi label="Itens de checklist concluídos" value={k.itensConcluidos} previous={prev.itensConcluidos} tone="good" />
        <Kpi label="Cards concluídos" value={k.cardsConcluidos} previous={prev.cardsConcluidos} tone="indigo" />
        <Kpi label="Comentários" value={k.comentarios} previous={prev.comentarios} tone="amber" />
        <Kpi label="Cards criados" value={k.cardsCriados} previous={prev.cardsCriados} />
      </section>
      <section className="kpi-grid kpi-grid-5">
        <Kpi label="Cards em aberto" value={k.cardsAbertos} hint="Cards abertos fora das listas de concluído" />
        <Kpi label="Cards atrasados" value={k.cardsAtrasados} tone={k.cardsAtrasados ? 'bad' : undefined} hint="Data de entrega já passou" />
        <Kpi label="Itens pendentes" value={k.itensPendentes} />
        <Kpi label="Itens atrasados" value={k.itensAtrasados} tone={k.itensAtrasados ? 'bad' : undefined} hint="Data de fim já passou" />
        <Kpi label="Checklists concluídas" value={k.taxaChecklist} suffix="%" hint="Itens feitos sobre o total, em cards abertos" />
      </section>

      <section className="grid-2-1">
        <div className="panel">
          <h2>Atividade por dia</h2>
          <div className="chart-box"><DailyChart serie={data.serie} /></div>
        </div>
        <div className="panel">
          <h2>Horário da atividade</h2>
          <div className="chart-box"><HoursChart horas={data.horas} /></div>
        </div>
      </section>

      <section className="panel">
        <h2>Pessoas no período</h2>
        <Ranking rows={data.ranking} />
      </section>

      <section>
        <h2 className="section-title">Quadros</h2>
        <div className="board-grid">
          {data.quadros.map((b) => <BoardPanel key={b.id} b={b} />)}
        </div>
      </section>
    </>
  )
}

const baseOptions = (c) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: c.text } } },
  scales: {
    x: { stacked: true, grid: { display: false }, ticks: { color: c.text }, border: { color: c.grid } },
    y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: c.text }, grid: { color: c.grid }, border: { color: c.grid } },
  },
})

function DailyChart({ serie }) {
  const C = usePalette()
  const labels = serie.map((d) => shortDate(d.data))
  const chart = {
    labels,
    datasets: [
      { type: 'line', label: 'Comentários', data: serie.map((d) => d.comentarios), borderColor: C.comentarios,
        backgroundColor: C.comentarios, tension: 0.35, pointRadius: 2, stack: 'line', yAxisID: 'y2' },
      { label: 'Itens concluídos', data: serie.map((d) => d.itensConcluidos), backgroundColor: C.itens, borderRadius: 4, stack: 'done' },
      { label: 'Cards concluídos', data: serie.map((d) => d.cardsConcluidos), backgroundColor: C.cards, borderRadius: 4, stack: 'done' },
    ],
  }
  const base = baseOptions(C)
  const options = {
    ...base,
    scales: {
      ...base.scales,
      y2: { position: 'right', beginAtZero: true, ticks: { precision: 0, color: C.text }, grid: { display: false }, border: { color: C.grid } },
    },
  }
  return <Bar data={chart} options={options} />
}

function HoursChart({ horas }) {
  const C = usePalette()
  const first = Math.min(7, ...horas.map((v, h) => (v ? h : 24)))
  const last = Math.max(19, ...horas.map((v, h) => (v ? h : -1)))
  const range = horas.slice(first, last + 1)
  const chart = {
    labels: range.map((_, i) => `${first + i}h`),
    datasets: [{ label: 'Ações', data: range, backgroundColor: C.horas, hoverBackgroundColor: C.itens, borderRadius: 4 }],
  }
  return <Bar data={chart} options={{ ...baseOptions(C), plugins: { legend: { display: false } } }} />
}

function Ranking({ rows }) {
  const C = usePalette()
  if (!rows.length) return <p className="muted">Sem atividade no período.</p>
  const max = Math.max(1, ...rows.map((r) => r.itensConcluidos + r.cardsConcluidos + r.comentarios))
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Pessoa</th>
            <th className="bar-col">Produção</th>
            <th className="num">Itens feitos</th>
            <th className="num">Cards concluídos</th>
            <th className="num">Comentários</th>
            <th className="num">Cards criados</th>
            <th className="num">Itens pendentes</th>
            <th className="num">Cards pendentes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = r.itensConcluidos + r.cardsConcluidos + r.comentarios
            const w = (v) => `${(100 * v) / max}%`
            return (
              <tr key={r.pessoa.id}>
                <td><div className="who"><Avatar pessoa={r.pessoa} size={28} /><span>{r.pessoa.nome}</span></div></td>
                <td className="bar-col">
                  <div className="stackbar" title={`${total} ações`}>
                    <span style={{ width: w(r.itensConcluidos), background: C.itens }} />
                    <span style={{ width: w(r.cardsConcluidos), background: C.cards }} />
                    <span style={{ width: w(r.comentarios), background: C.comentarios }} />
                  </div>
                </td>
                <td className="num">{fmt(r.itensConcluidos)}</td>
                <td className="num">{fmt(r.cardsConcluidos)}</td>
                <td className="num">{fmt(r.comentarios)}</td>
                <td className="num">{fmt(r.cardsCriados)}</td>
                <td className="num">
                  {fmt(r.itensPendentes)}
                  {r.itensAtrasados > 0 && <span className="late"> ({r.itensAtrasados} atras.)</span>}
                </td>
                <td className="num">
                  {fmt(r.cardsPendentes)}
                  {r.cardsAtrasados > 0 && <span className="late"> ({r.cardsAtrasados} atras.)</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BoardPanel({ b }) {
  const pct = b.itensTotal ? Math.round((100 * b.itensFeitos) / b.itensTotal) : null
  const maxList = Math.max(1, ...b.listas.map((l) => l.cards))
  return (
    <div className="panel board-panel">
      <div className="board-panel-head">
        <h3>{b.nome}</h3>
        <a href={b.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-icon" title="Abrir no Trello"><Icon name="external" /></a>
      </div>
      <div className="mini-stats">
        <div title="Itens de checklist com prazo no período e marcados como feitos">
          <strong className={b.itensConcluidos ? 'good' : ''}>{fmt(b.itensConcluidos)}</strong><span>itens feitos</span>
        </div>
        <div title="Cards movidos para uma lista de concluído ou com a entrega marcada, no período">
          <strong>{fmt(b.cardsConcluidos)}</strong><span>cards concluídos</span>
        </div>
        <div className={b.cardsAtrasados + b.itensAtrasados ? 'bad' : ''}
          title={`${b.cardsAtrasados} cards e ${b.itensAtrasados} itens com prazo vencido`}>
          <strong>{fmt(b.cardsAtrasados + b.itensAtrasados)}</strong><span>atrasados</span>
        </div>
        <div><strong>{fmt(b.cardsAbertos)}</strong><span>cards em aberto</span></div>
      </div>
      {pct !== null && (
        <div className="progress-row">
          <span>Checklists</span>
          <div className="progress"><span style={{ width: `${pct}%` }} /></div>
          <span className="num">{b.itensFeitos}/{b.itensTotal}</span>
        </div>
      )}
      <ul className="list-bars">
        {b.listas.map((l) => (
          <li key={l.id} className={l.concluida ? 'done' : ''}>
            <span className="truncate" title={l.nome}>{l.nome}</span>
            <div className="list-bar"><span style={{ width: `${(100 * l.cards) / maxList}%` }} /></div>
            <span className="num">{l.cards}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
