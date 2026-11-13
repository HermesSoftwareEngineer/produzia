import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Icon } from '../components/ui.jsx'
import { ThemeSwitch } from '../theme.jsx'

const RETURN_KEY = 'produzia.voltarPara'

// Logo do Trello (marca do produto que a pessoa vai autorizar).
function TrelloMark() {
  return (
    <svg className="trello-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="4.5" fill="currentColor" />
      <rect x="4.6" y="4.6" width="6" height="13.2" rx="1.3" fill="#fff" />
      <rect x="13.4" y="4.6" width="6" height="8" rx="1.3" fill="#fff" />
    </svg>
  )
}

export function trelloAuthorizeUrl(key) {
  const params = new URLSearchParams({
    expiration: 'never',
    name: 'Produzia',
    scope: 'read',
    response_type: 'token',
    callback_method: 'fragment',
    return_url: `${window.location.origin}/auth/trello`,
    key,
  })
  return `https://trello.com/1/authorize?${params}`
}

export default function Login({ onLogin }) {
  const [config, setConfig] = useState(null)
  const [form, setForm] = useState({ usuario: '', senha: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    api('/auth/config').then(setConfig).catch(() => setConfig({ trelloKey: '', loginAdmin: true }))
  }, [])

  function trelloLogin() {
    try { sessionStorage.setItem(RETURN_KEY, location.state?.from || '/') } catch { /* sem storage */ }
    window.location.href = trelloAuthorizeUrl(config.trelloKey)
  }

  async function adminLogin(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await api('/login', { method: 'POST', body: form })
      onLogin(data)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <ThemeSwitch />
      <div className="login-card">
        <div className="brand brand-lg"><span className="brand-mark"><Icon name="bars" /></span><span>Produzia</span></div>
        <p className="muted">Produtividade dos seus quadros do Trello, por pessoa e por dia.</p>

        <button className="btn btn-trello btn-block" type="button" disabled={!config?.trelloKey} onClick={trelloLogin}>
          <TrelloMark />Entrar com Trello
        </button>
        <p className="login-hint">Você vê só os quadros de que participa no Trello. O Produzia só lê os dados, não altera nada.</p>

        {config?.loginAdmin && (
          <details className="login-admin">
            <summary>Entrar como administrador</summary>
            <form onSubmit={adminLogin}>
              <label>Usuário
                <input autoComplete="username" required value={form.usuario}
                  onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
              </label>
              <label>Senha
                <input type="password" autoComplete="current-password" required value={form.senha}
                  onChange={(e) => setForm({ ...form, senha: e.target.value })} />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button className="btn btn-ghost btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
            </form>
          </details>
        )}
      </div>
    </div>
  )
}

/** Volta do Trello: o token chega no fragmento da URL (#token=...). */
export function TrelloCallback({ onLogin }) {
  const navigate = useNavigate()
  const [error, setError] = useState(null)

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const token = hash.get('token')
    // Tira o token da barra de endereço e do histórico.
    window.history.replaceState(null, '', '/auth/trello')
    if (!token) {
      setError(hash.get('error') ? 'A autorização foi cancelada no Trello.' : 'O Trello não devolveu a autorização.')
      return
    }
    api('/auth/trello', { method: 'POST', body: { token } })
      .then((data) => {
        let back = '/'
        try { back = sessionStorage.getItem(RETURN_KEY) || '/'; sessionStorage.removeItem(RETURN_KEY) } catch { /* ignora */ }
        onLogin(data)
        navigate(back.startsWith('/') && !back.startsWith('/auth') ? back : '/', { replace: true })
      })
      .catch((err) => setError(err.message))
  }, [navigate, onLogin])

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand brand-lg"><span className="brand-mark"><Icon name="bars" /></span><span>Produzia</span></div>
        {error ? (
          <>
            <p className="form-error">{error}</p>
            <button className="btn btn-primary btn-block" type="button" onClick={() => navigate('/login', { replace: true })}>
              Voltar ao login
            </button>
          </>
        ) : (
          <p className="muted"><span className="spinner sm" /> Entrando com sua conta do Trello…</p>
        )}
      </div>
    </div>
  )
}
