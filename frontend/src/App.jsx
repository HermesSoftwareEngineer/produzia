import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import { BoardsProvider, useBoards } from './boards.jsx'
import BoardFilter from './components/BoardFilter.jsx'
import { Icon, Loading } from './components/ui.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Login from './pages/Login.jsx'
import Quadros from './pages/Quadros.jsx'
import Resumo from './pages/Resumo.jsx'
import { ThemeSwitch } from './theme.jsx'

// Markdown e Mermaid so carregam quando a pagina de processos abre.
const Processos = lazy(() => import('./pages/Processos.jsx'))

const TITLES = { '/': 'Dashboard', '/resumo': 'Resumo do dia', '/quadros': 'Quadros', '/processos': 'Processos' }

export default function App() {
  const [user, setUser] = useState(undefined)
  const location = useLocation()

  useEffect(() => {
    api('/me').then((d) => setUser(d.usuario)).catch(() => setUser(null))
  }, [])

  if (user === undefined) return <div className="loading full"><span className="spinner" /></div>
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
      </Routes>
    )
  }
  return (
    <BoardsProvider>
      <Shell onLogout={() => setUser(null)} />
    </BoardsProvider>
  )
}

function Shell({ onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { refresh } = useBoards()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    document.title = `${TITLES[location.pathname] || 'Produzia'} · Produzia`
  }, [location.pathname])

  async function logout() {
    await api('/logout', { method: 'POST' }).catch(() => {})
    onLogout()
    navigate('/login')
  }

  async function reloadData() {
    setRefreshing(true)
    await api('/cache/clear', { method: 'POST' }).catch(() => {})
    refresh()
    setTimeout(() => setRefreshing(false), 700)
  }

  const showFilter = !['/quadros', '/processos'].includes(location.pathname)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="bars" /></span><span>Produzia</span></div>
        <nav>
          <NavLink to="/" end><Icon name="dashboard" /><span>Dashboard</span></NavLink>
          <NavLink to="/resumo"><Icon name="calendar" /><span>Resumo do dia</span></NavLink>
          <NavLink to="/processos"><Icon name="flow" /><span>Processos</span></NavLink>
          <NavLink to="/quadros"><Icon name="board" /><span>Quadros</span></NavLink>
        </nav>
        <ThemeSwitch />
        <button className="logout" type="button" onClick={logout}><Icon name="logout" /><span>Sair</span></button>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{TITLES[location.pathname]}</h1>
          <div className="topbar-right">
            {showFilter && <BoardFilter />}
            {showFilter && (
              <button className={`btn btn-ghost btn-icon ${refreshing ? 'spin' : ''}`} type="button"
                title="Buscar dados novos no Trello" onClick={reloadData}>
                <Icon name="refresh" />
              </button>
            )}
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/resumo" element={<Resumo />} />
            <Route path="/processos" element={<Suspense fallback={<Loading text="Carregando…" />}><Processos /></Suspense>} />
            <Route path="/quadros" element={<Quadros />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
