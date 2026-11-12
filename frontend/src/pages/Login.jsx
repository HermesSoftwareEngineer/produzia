import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Icon } from '../components/ui.jsx'

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ usuario: '', senha: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await api('/login', { method: 'POST', body: form })
      onLogin(data.usuario)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-lg"><span className="brand-mark"><Icon name="bars" /></span><span>Produzia</span></div>
        <p className="muted">Produtividade dos seus quadros do Trello, por pessoa e por dia.</p>
        <label>Usuário
          <input autoComplete="username" required autoFocus value={form.usuario}
            onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
        </label>
        <label>Senha
          <input type="password" autoComplete="current-password" required value={form.senha}
            onChange={(e) => setForm({ ...form, senha: e.target.value })} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}
