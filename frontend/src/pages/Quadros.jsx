import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useBoards } from '../boards.jsx'
import { ErrorBox, Icon, Loading } from '../components/ui.jsx'

export default function Quadros() {
  const { boards, reload } = useBoards()
  const [ref, setRef] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    api('/trello/boards').then((d) => setAvailable(d.quadros)).catch((e) => { setAvailable([]); setError(e) })
  }, [boards.length])

  async function add(value) {
    setBusy(true)
    setError(null)
    try {
      await api('/boards', { method: 'POST', body: { ref: value } })
      setRef('')
      await reload()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const options = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return (available || []).filter((b) => !b.cadastrado && (!term || b.nome.toLowerCase().includes(term)
      || (b.workspace || '').toLowerCase().includes(term)))
  }, [available, filter])

  return (
    <div className="page">
      <section className="panel">
        <h2>Cadastrar quadro</h2>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) add(ref.trim()) }}>
          <input placeholder="Cole o link do quadro (https://trello.com/b/…)" value={ref} onChange={(e) => setRef(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !ref.trim()}><Icon name="plus" />Cadastrar</button>
        </form>
        <ErrorBox error={error} />

        <details className="available">
          <summary>Ou escolha entre os quadros que a conta do Trello enxerga</summary>
          {available === null ? <Loading text="Carregando quadros…" /> : (
            <>
              <div className="search">
                <Icon name="search" />
                <input placeholder="Buscar quadro…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <ul className="available-list">
                {options.map((b) => (
                  <li key={b.id}>
                    <div>
                      <strong>{b.nome}</strong>
                      {b.workspace && <span className="muted small">{b.workspace}</span>}
                    </div>
                    <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => add(b.id)}>
                      <Icon name="plus" />Adicionar
                    </button>
                  </li>
                ))}
                {!options.length && <li className="muted">Nenhum quadro disponível.</li>}
              </ul>
            </>
          )}
        </details>
      </section>

      <h2 className="section-title">Quadros acompanhados ({boards.length})</h2>
      {!boards.length && <p className="muted">Nenhum quadro cadastrado ainda.</p>}
      <div className="board-config-list">
        {boards.map((b) => <BoardConfig key={b.id} board={b} onChange={reload} />)}
      </div>
    </div>
  )
}

function BoardConfig({ board, onChange }) {
  const [lists, setLists] = useState(null)
  const [done, setDone] = useState(board.doneListIds)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api(`/boards/${board.id}/lists`).then((d) => setLists(d.listas)).catch(setError)
  }, [board.id])

  async function toggle(id) {
    const next = done.includes(id) ? done.filter((i) => i !== id) : [...done, id]
    setDone(next)
    setError(null)
    try {
      await api(`/boards/${board.id}`, { method: 'PUT', body: { doneListIds: next } })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      onChange()
    } catch (e) {
      setError(e)
      setDone(done)
    }
  }

  async function remove() {
    if (!window.confirm(`Parar de acompanhar o quadro "${board.nome}"?`)) return
    await api(`/boards/${board.id}`, { method: 'DELETE' }).catch(setError)
    onChange()
  }

  return (
    <article className="panel board-config">
      <header>
        <div>
          <h3>{board.nome}</h3>
          <a className="muted small" href={board.url} target="_blank" rel="noreferrer">{board.url}</a>
        </div>
        <button className="btn btn-ghost btn-icon danger" type="button" title="Remover" onClick={remove}><Icon name="trash" /></button>
      </header>
      <p className="muted small">
        Listas que contam como <strong>concluído</strong> (mover um card para elas conta como card concluído):
        {saved && <span className="saved"> salvo ✓</span>}
      </p>
      <ErrorBox error={error} />
      {lists === null ? <Loading text="Carregando listas…" /> : (
        <div className="chips">
          {lists.filter((l) => !l.arquivada || done.includes(l.id)).map((l) => (
            <button key={l.id} type="button" className={`chip-toggle ${done.includes(l.id) ? 'on' : ''}`} onClick={() => toggle(l.id)}>
              {done.includes(l.id) && <Icon name="check" />}{l.nome}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}
