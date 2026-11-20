// "Nova tarefa": cria um item de checklist (num card existente) ou um card novo, já com data.
// Usado pelo calendário. Lembra o último tipo, quadro, lista e card escolhidos.
import { useEffect, useMemo, useRef, useState } from 'react'
import { boardApi, cardApi, dateShortcuts, todayIso } from '../edit.js'
import { longDate, shortDate } from '../format.js'
import { Avatar, Icon } from './ui.jsx'

const PREFS = 'produzia.novaTarefa'
const NEW_CHECKLIST = '__nova'
const optionsCache = new Map()

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS)) || {} } catch { return {} }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)) } catch { /* sem storage */ }
}

function loadOptions(boardId) {
  if (!optionsCache.has(boardId)) {
    const p = boardApi.options(boardId).catch((err) => { optionsCache.delete(boardId); throw err })
    optionsCache.set(boardId, p)
  }
  return optionsCache.get(boardId)
}

export default function TaskComposer({ initial, boards, onClose, onCreated }) {
  const prefs = useRef(readPrefs())
  const firstBoard = boards.find((b) => b.id === (initial.quadroId || prefs.current.quadroId))?.id || boards[0]?.id || ''
  const [tipo, setTipo] = useState(initial.tipo || prefs.current.tipo || 'item')
  const [quadroId, setQuadroId] = useState(firstBoard)
  const [opts, setOpts] = useState(null)
  const [optsError, setOptsError] = useState(null)
  const [titulo, setTitulo] = useState('')
  const [prazo, setPrazo] = useState(initial.data || todayIso())
  const [inicio, setInicio] = useState('')
  const [showInicio, setShowInicio] = useState(false)
  const [listaId, setListaId] = useState('')
  const [membros, setMembros] = useState([])
  const [cardId, setCardId] = useState(initial.cardId || '')
  const [checklists, setChecklists] = useState(null)
  const [checklistId, setChecklistId] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [another, setAnother] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const titleRef = useRef(null)

  // Opções do quadro (listas, membros, cards).
  useEffect(() => {
    if (!quadroId) return undefined
    let alive = true
    setOpts(null)
    setOptsError(null)
    loadOptions(quadroId).then((o) => {
      if (!alive) return
      setOpts(o)
      const p = prefs.current
      const lists = o.listas.filter((l) => !l.concluida)
      const savedList = p.listas?.[quadroId]
      setListaId(lists.some((l) => l.id === savedList) ? savedList : (lists[0] || o.listas[0])?.id || '')
      const savedCard = initial.cardId || p.cards?.[quadroId]
      setCardId(o.cards.some((c) => c.id === savedCard) ? savedCard : '')
      setMembros([])
      setResponsavelId('')
    }).catch((err) => alive && setOptsError(err))
    return () => { alive = false }
  }, [quadroId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Checklists do card escolhido.
  useEffect(() => {
    if (tipo !== 'item' || !cardId) { setChecklists(null); return undefined }
    let alive = true
    setChecklists(null)
    cardApi.get(cardId).then((d) => {
      if (!alive) return
      setChecklists(d.checklists)
      setChecklistId(d.checklists[0]?.id || NEW_CHECKLIST)
    }).catch((err) => alive && (setChecklists([]), setChecklistId(NEW_CHECKLIST), setError(err.message)))
    return () => { alive = false }
  }, [cardId, tipo])

  useEffect(() => { titleRef.current?.focus() }, [tipo])

  const dirty = titulo.trim().length > 0
  const close = () => { if (!dirty || window.confirm('Descartar a tarefa que você começou a escrever?')) onClose() }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function remember() {
    const p = prefs.current
    p.tipo = tipo
    p.quadroId = quadroId
    if (tipo === 'card') p.listas = { ...p.listas, [quadroId]: listaId }
    else p.cards = { ...p.cards, [quadroId]: cardId }
    savePrefs(p)
  }

  async function submit(e) {
    e?.preventDefault()
    if (busy) return
    if (!titulo.trim()) { setError(tipo === 'card' ? 'Escreva o título do card.' : 'Escreva o texto do item.'); titleRef.current?.focus(); return }
    if (inicio && prazo && inicio > prazo) { setError('O início não pode ser depois do prazo.'); return }
    if (tipo === 'card' && !listaId) { setError('Escolha a lista do card.'); return }
    if (tipo === 'item' && !cardId) { setError('Escolha o card onde o item vai entrar.'); return }
    setBusy(true)
    setError(null)
    try {
      let created
      if (tipo === 'card') {
        const card = await boardApi.createCard(quadroId, {
          nome: titulo.trim(), listaId, prazo: prazo || null, inicio: inicio || null, membros,
        })
        optionsCache.delete(quadroId)
        created = { tipo, cardId: card.id, titulo: card.nome, prazo: card.prazo }
      } else {
        let clId = checklistId
        if (clId === NEW_CHECKLIST) {
          const cl = await cardApi.addChecklist(cardId, 'Checklist')
          clId = cl.id
          setChecklists((l) => [...(l || []), cl])
          setChecklistId(cl.id)
        }
        const item = await cardApi.addItem(cardId, clId, {
          texto: titulo.trim(), dataFim: prazo || null, dataInicio: inicio || null, responsavelId: responsavelId || null,
        })
        created = { tipo, cardId, itemId: item.id, titulo: item.texto, prazo }
      }
      remember()
      onCreated(created, { keepOpen: another })
      if (another) {
        setTitulo('')
        titleRef.current?.focus()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const lists = opts?.listas || []
  const membersById = useMemo(() => new Map((opts?.membros || []).map((m) => [m.id, m])), [opts])
  const toggleMember = (id) => setMembros((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))
  const shortcuts = dateShortcuts(todayIso())

  return (
    <div className="tc-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <form className="tc-panel" role="dialog" aria-modal="true" aria-label="Nova tarefa" onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e) }}>
        <header className="tc-head">
          <div className="segmented tc-type" role="radiogroup" aria-label="Tipo de tarefa">
            <button type="button" role="radio" aria-checked={tipo === 'item'} className={tipo === 'item' ? 'active' : ''}
              onClick={() => setTipo('item')}><Icon name="checkCircle" />Item de checklist</button>
            <button type="button" role="radio" aria-checked={tipo === 'card'} className={tipo === 'card' ? 'active' : ''}
              onClick={() => setTipo('card')}><Icon name="card" />Card</button>
          </div>
          <button className="btn btn-ghost btn-icon tc-x" type="button" title="Fechar (Esc)" onClick={close}><Icon name="close" /></button>
        </header>

        <textarea ref={titleRef} className="tc-title" rows={2} value={titulo} maxLength={2000}
          placeholder={tipo === 'card' ? 'Título do card' : 'O que precisa ser feito?'}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); submit() } }} />

        <div className="tc-grid">
          <label className="tc-field">
            <span><Icon name="board" />Quadro</span>
            <select value={quadroId} onChange={(e) => setQuadroId(e.target.value)}>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </label>

          {tipo === 'card' ? (
            <label className="tc-field">
              <span><Icon name="bars" />Lista</span>
              <select value={listaId} onChange={(e) => setListaId(e.target.value)} disabled={!opts}>
                {!opts && <option>Carregando…</option>}
                {lists.map((l) => <option key={l.id} value={l.id}>{l.nome}{l.concluida ? ' (concluída)' : ''}</option>)}
              </select>
            </label>
          ) : (
            <div className="tc-field">
              <span><Icon name="card" />Card</span>
              <CardPicker cards={opts?.cards} lists={lists} value={cardId} onChange={setCardId} />
            </div>
          )}

          {tipo === 'item' && cardId && (
            <label className="tc-field">
              <span><Icon name="item" />Checklist</span>
              <select value={checklistId} onChange={(e) => setChecklistId(e.target.value)} disabled={!checklists}>
                {!checklists && <option>Carregando…</option>}
                {(checklists || []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                {checklists && <option value={NEW_CHECKLIST}>+ Nova checklist</option>}
              </select>
            </label>
          )}

          {tipo === 'item' && (
            <label className="tc-field">
              <span><Icon name="circle" />Responsável</span>
              <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} disabled={!opts}>
                <option value="">Sem responsável</option>
                {opts?.euId && membersById.has(opts.euId) && <option value={opts.euId}>Eu ({membersById.get(opts.euId).nome})</option>}
                {(opts?.membros || []).filter((m) => m.id !== opts.euId).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="tc-dates">
          <div className="tc-field tc-due">
            <span><Icon name="calendar" />Prazo</span>
            <div className="tc-date-row">
              <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} aria-label="Prazo" />
              <div className="tc-quick">
                {shortcuts.slice(0, 3).map((s) => (
                  <button key={s.key} type="button" className={`chip-toggle ${prazo === s.date ? 'on' : ''}`}
                    onClick={() => setPrazo(s.date)} title={longDate(s.date)}>{s.label}</button>
                ))}
                {prazo && <button type="button" className="link-btn" onClick={() => setPrazo('')}>Sem data</button>}
              </div>
            </div>
            {!prazo && <small className="tc-hint">Sem prazo, a tarefa não aparece no calendário.</small>}
          </div>
          {showInicio || inicio ? (
            <label className="tc-field tc-start">
              <span><Icon name="clock" />Início</span>
              <div className="tc-date-row">
                <input type="date" value={inicio} max={prazo || undefined} onChange={(e) => setInicio(e.target.value)} aria-label="Início" />
                <button type="button" className="link-btn" onClick={() => { setInicio(''); setShowInicio(false) }}>Remover</button>
              </div>
            </label>
          ) : (
            <button type="button" className="link-btn tc-add-start" onClick={() => setShowInicio(true)}><Icon name="plus" />Data de início</button>
          )}
        </div>

        {tipo === 'card' && opts && opts.membros.length > 0 && (
          <div className="tc-field">
            <span><Icon name="circle" />Membros</span>
            <div className="tc-members">
              {opts.membros.map((m) => (
                <button key={m.id} type="button" className={`tc-member ${membros.includes(m.id) ? 'on' : ''}`}
                  aria-pressed={membros.includes(m.id)} onClick={() => toggleMember(m.id)} title={m.nome}>
                  <Avatar pessoa={m} size={22} /><span>{m.id === opts.euId ? 'Eu' : m.nome.split(' ')[0]}</span>
                  {membros.includes(m.id) && <Icon name="check" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {optsError && <p className="form-error"><Icon name="warning" />{optsError.message}</p>}
        {error && <p className="form-error"><Icon name="warning" />{error}</p>}

        <footer className="tc-foot">
          <label className="toggle tc-another">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} />
            <span>Criar outra em seguida</span>
          </label>
          <span className="tc-spacer" />
          <button className="btn btn-ghost" type="button" onClick={close}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy || !opts} title="Enter cria · Shift+Enter quebra linha no título">
            {busy ? 'Criando…' : tipo === 'card' ? 'Criar card' : 'Criar item'}
            {prazo && !busy && <small className="tc-btn-date">{shortDate(prazo)}</small>}
          </button>
        </footer>
      </form>
    </div>
  )
}

// Escolha do card com busca (agrupado por lista, setas + Enter).
function CardPicker({ cards, lists, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef(null)
  const listRef = useRef(null)
  const selected = cards?.find((c) => c.id === value)
  const listName = useMemo(() => new Map(lists.map((l) => [l.id, l.nome])), [lists])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (cards || []).filter((c) => !term || c.nome.toLowerCase().includes(term) || (listName.get(c.listaId) || '').toLowerCase().includes(term)).slice(0, 200)
  }, [cards, query, listName])

  useEffect(() => {
    if (!open) return undefined
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (c) => { onChange(c.id); setOpen(false); setQuery('') }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); e.stopPropagation(); if (filtered[active]) pick(filtered[active]) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
  }

  let lastList = null
  return (
    <div className="tc-picker" ref={ref}>
      <div className="tc-picker-input">
        <Icon name="search" />
        <input value={open ? query : selected?.nome || ''} disabled={!cards}
          placeholder={cards ? 'Buscar card…' : 'Carregando…'} role="combobox" aria-expanded={open} aria-autocomplete="list"
          onFocus={() => { setOpen(true); setQuery('') }} onChange={(e) => { setQuery(e.target.value); setOpen(true) }} onKeyDown={onKey} />
        {selected && !open && <span className="tc-picker-list">{listName.get(selected.listaId)}</span>}
      </div>
      {open && cards && (
        <ul className="tc-picker-menu" role="listbox" ref={listRef}>
          {!filtered.length && <li className="tc-picker-empty">Nenhum card encontrado.</li>}
          {filtered.map((c, i) => {
            const head = c.listaId !== lastList
            lastList = c.listaId
            return (
              <li key={c.id} role="presentation">
                {head && <div className="tc-picker-group">{listName.get(c.listaId)}</div>}
                <button type="button" role="option" aria-selected={c.id === value} data-active={i === active}
                  className={`${i === active ? 'active' : ''} ${c.id === value ? 'selected' : ''}`}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
                  <span className="truncate">{c.nome}</span>
                  {c.id === value && <Icon name="check" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
