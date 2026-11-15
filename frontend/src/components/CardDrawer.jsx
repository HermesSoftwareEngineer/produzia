// Editor de card e itens de checklist dentro do Produzia (painel lateral).
// Abre por useCardEditor().openCard(cardId, { itemId }) no resumo, cronograma e calendário.
// Toda escrita passa por cardApi (edit.js): campos do card no Trello, itens no Power-Up.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBoards } from '../boards.jsx'
import { cardApi, dateShortcuts, todayIso, typing } from '../edit.js'
import { shortDate } from '../format.js'
import { EditorContext } from './editorContext.js'
import { useToast } from './Toasts.jsx'
import { Avatar, Icon } from './ui.jsx'

const Markdown = lazy(() => import('./Markdown.jsx'))
const CLOSE_MS = 180

export function CardEditorProvider({ children }) {
  const [state, setState] = useState(null) // { cardId, itemId, onChanged }
  const { refresh } = useBoards()

  const openCard = useCallback((cardId, opts = {}) => {
    if (cardId) setState({ cardId, itemId: opts.itemId || null, onChanged: opts.onChanged })
  }, [])

  const close = useCallback((changed) => {
    const done = state
    setState(null)
    // A página recarrega os dados (o servidor já descartou o cache do quadro).
    if (changed) { done?.onChanged?.(); refresh() }
  }, [state, refresh])

  const value = useMemo(() => ({ openCard }), [openCard])
  return (
    <EditorContext.Provider value={value}>
      {children}
      {state && <CardDrawer key={state.cardId} cardId={state.cardId} itemId={state.itemId} onClose={close} />}
    </EditorContext.Provider>
  )
}

export { useCardEditor } from './editorContext.js'

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]))
const LABEL_COLORS = {
  green: '#22a06b', yellow: '#cf9f02', orange: '#e56910', red: '#c9372c', purple: '#8f7ee7', blue: '#0c66e4',
  sky: '#2898bd', lime: '#5b7f24', pink: '#ae4787', black: '#626f86',
}
const labelColor = (cor) => LABEL_COLORS[(cor || '').replace(/_(light|dark)$/, '')] || '#626f86'

function CardDrawer({ cardId, itemId, onClose }) {
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [closing, setClosing] = useState(false)
  const changed = useRef(false)
  const panelRef = useRef(null)

  const load = useCallback(() => {
    setError(null)
    cardApi.get(cardId).then(setData).catch(setError)
  }, [cardId])
  useEffect(load, [load])

  const close = useCallback(() => {
    setClosing(true)
    setTimeout(() => onClose(changed.current), CLOSE_MS)
  }, [onClose])

  // Item pedido (cronograma/resumo): rola até ele e destaca.
  useEffect(() => {
    if (!data || !itemId) return
    const el = panelRef.current?.querySelector(`[data-item="${itemId}"]`)
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash') }
  }, [data, itemId])

  const card = data?.card
  const setCard = (patch) => setData((d) => ({ ...d, card: { ...d.card, ...patch } }))
  const mapItems = (fn) => setData((d) => ({
    ...d, checklists: d.checklists.map((c) => ({ ...c, itens: fn(c.itens, c) })),
  }))
  const fail = (err) => toast({ text: err.message, tone: 'bad' })

  // Campos do card: aplica na hora, grava, e volta atrás se o Trello recusar.
  async function saveCard(patch, { text, undo = false } = {}) {
    const before = pick(card, Object.keys(patch))
    setCard(patch)
    try {
      const res = await cardApi.update(cardId, patch)
      const { anterior, ...fresh } = res
      setCard(fresh)
      changed.current = true
      if (text) {
        const restore = anterior && ('inicio' in patch || 'prazo' in patch) ? { ...before, ...pick(anterior, Object.keys(patch).filter((k) => k in anterior)) } : before
        toast({ text, tone: 'good', action: undo ? { label: 'Desfazer', onClick: () => saveCard(restore) } : undefined })
      }
    } catch (err) {
      setCard(before)
      fail(err)
    }
  }

  async function saveItem(item, patch, { text, undo = false } = {}) {
    const before = pick(item, Object.keys(patch))
    mapItems((itens) => itens.map((i) => (i.id === item.id ? { ...i, ...patch } : i)))
    try {
      const res = await cardApi.updateItem(cardId, item.id, patch)
      mapItems((itens) => itens.map((i) => (i.id === item.id ? { ...i, ...res } : i)))
      changed.current = true
      if (text) toast({ text, tone: 'good', action: undo ? { label: 'Desfazer', onClick: () => saveItem({ ...item, ...patch }, before) } : undefined })
    } catch (err) {
      mapItems((itens) => itens.map((i) => (i.id === item.id ? { ...i, ...before } : i)))
      fail(err)
    }
  }

  async function removeItem(item, checklist) {
    mapItems((itens) => itens.filter((i) => i.id !== item.id))
    try {
      await cardApi.deleteItem(cardId, item.id)
      changed.current = true
      toast({
        text: 'Item removido.', tone: 'good',
        action: { label: 'Desfazer', onClick: () => addItem(checklist, pick(item, ['texto', 'dataInicio', 'dataFim', 'responsavelId'])) },
      })
    } catch (err) {
      load()
      fail(err)
    }
  }

  async function addItem(checklist, body) {
    try {
      const res = await cardApi.addItem(cardId, checklist.id, body)
      mapItems((itens, c) => (c.id === checklist.id ? [...itens, res] : itens))
      changed.current = true
      return true
    } catch (err) {
      fail(err)
      return false
    }
  }

  async function addChecklist(nome) {
    try {
      const res = await cardApi.addChecklist(cardId, nome)
      setData((d) => ({ ...d, checklists: [...d.checklists, { itens: [], ...res }] }))
      changed.current = true
    } catch (err) { fail(err) }
  }

  async function toggleSet(kind, id) {
    const field = kind === 'membro' ? 'membros' : 'etiquetas'
    const has = card[field].includes(id)
    const before = card[field]
    setCard({ [field]: has ? before.filter((x) => x !== id) : [...before, id] })
    try {
      if (kind === 'membro') await (has ? cardApi.removeMember(cardId, id) : cardApi.addMember(cardId, id))
      else await (has ? cardApi.removeLabel(cardId, id) : cardApi.addLabel(cardId, id))
      changed.current = true
    } catch (err) {
      setCard({ [field]: before })
      fail(err)
    }
  }

  // Esc fecha; "c" conclui/reabre o card (fora de campos de texto).
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (!card || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'c') {
        e.preventDefault()
        saveCard({ concluido: !card.concluido }, { text: card.concluido ? 'Card reaberto.' : 'Card concluído.', undo: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const lista = data?.listas.find((l) => l.id === card?.listaId)
  const people = useMemo(() => new Map((data?.membros || []).map((p) => [p.id, p])), [data])

  return (
    <div className={`cd-overlay ${closing ? 'closing' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <aside className="cd-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={card ? `Card ${card.nome}` : 'Card'}>
        <header className="cd-head">
          <span className="cd-crumb truncate">{data ? `${data.quadro.nome}${lista ? ` › ${lista.nome}` : ''}` : 'Card'}</span>
          {card && (
            <a className="btn btn-ghost cd-trello" href={card.url} target="_blank" rel="noreferrer">
              <Icon name="external" />Abrir no Trello
            </a>
          )}
          <button className="btn btn-ghost btn-icon" type="button" onClick={close} aria-label="Fechar (Esc)" title="Fechar (Esc)">
            <Icon name="close" />
          </button>
        </header>

        <div className="cd-body">
          {error && (
            <div className="cd-error">
              <div className="alert alert-error"><Icon name="warning" /><span>{error.message}</span></div>
              <button className="btn btn-ghost" type="button" onClick={load}><Icon name="refresh" />Tentar de novo</button>
            </div>
          )}
          {!data && !error && <DrawerSkeleton />}
          {card && (
            <>
              {data.avisos?.map((a) => <div key={a} className="alert alert-warn"><Icon name="warning" /><span>{a}</span></div>)}
              <div className="cd-title-row">
                <button type="button" className={`cd-done ${card.concluido ? 'on' : ''}`} title="Concluído (c)"
                  aria-pressed={card.concluido}
                  onClick={() => saveCard({ concluido: !card.concluido }, { text: card.concluido ? 'Card reaberto.' : 'Card concluído.', undo: true })}>
                  <Icon name={card.concluido ? 'check' : 'circle'} />
                </button>
                <InlineText className="cd-title" value={card.nome} label="Título do card"
                  onSave={(nome) => saveCard({ nome }, { text: 'Título salvo.', undo: true })} />
              </div>

              <div className="cd-grid">
                <Field label="Lista">
                  <select value={card.listaId || ''} onChange={(e) => {
                    const to = data.listas.find((l) => l.id === e.target.value)
                    saveCard({ listaId: e.target.value }, { text: `Movido para ${to?.nome}.`, undo: true })
                  }}>
                    {!lista && <option value="">—</option>}
                    {data.listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
                </Field>
                <Field label="Início">
                  <DateInput value={card.inicio} max={card.prazo}
                    onChange={(inicio) => saveCard({ inicio }, { text: 'Início alterado.', undo: true })} />
                </Field>
                <Field label="Prazo">
                  <DateInput value={card.prazo} min={card.inicio} shortcuts
                    onChange={(prazo) => saveCard({ prazo }, { text: prazo ? `Prazo: ${shortDate(prazo)}.` : 'Prazo removido.', undo: true })} />
                </Field>
              </div>

              <Section title="Membros">
                <ChipPicker
                  options={data.membros.map((p) => ({ id: p.id, label: p.nome, node: <Avatar pessoa={p} size={20} /> }))}
                  selected={card.membros} empty="Sem membros" addLabel="Membro"
                  onToggle={(id) => toggleSet('membro', id)} />
              </Section>

              <Section title="Etiquetas">
                <ChipPicker
                  options={data.etiquetas.map((l) => ({
                    id: l.id, label: l.nome || 'Sem nome', node: <i className="cd-dot" style={{ background: labelColor(l.cor) }} />,
                  }))}
                  selected={card.etiquetas} empty="Sem etiquetas" addLabel="Etiqueta"
                  onToggle={(id) => toggleSet('etiqueta', id)} />
              </Section>

              <Section title="Descrição">
                <Description value={card.descricao} onSave={(descricao) => saveCard({ descricao }, { text: 'Descrição salva.', undo: true })} />
              </Section>

              <Section title="Checklists" action={<NewChecklist onAdd={addChecklist} />}>
                {data.checklists.length === 0 && <p className="cd-empty">Nenhuma checklist neste card.</p>}
                {data.checklists.map((cl) => (
                  <Checklist key={cl.id} checklist={cl} people={people} membros={data.membros} focus={itemId}
                    onSave={saveItem} onRemove={(item) => removeItem(item, cl)} onAdd={(body) => addItem(cl, body)} />
                ))}
              </Section>

              <Section title="Comentários">
                <Comments cardId={cardId} data={data} setData={setData} onChange={() => { changed.current = true }} />
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function DrawerSkeleton() {
  return (
    <div className="cd-skeleton" aria-busy="true" aria-label="Carregando card">
      <span className="sk sk-title" />
      <div className="cd-grid"><span className="sk sk-field" /><span className="sk sk-field" /><span className="sk sk-field" /></div>
      <span className="sk sk-line" /><span className="sk sk-line short" />
      <span className="sk sk-block" />
      <span className="sk sk-line" /><span className="sk sk-line" /><span className="sk sk-line short" />
    </div>
  )
}

function Section({ title, action, children }) {
  return (
    <section className="cd-section">
      <div className="cd-section-head"><h3>{title}</h3>{action}</div>
      {children}
    </section>
  )
}

function Field({ label, children }) {
  return <label className="cd-field"><span>{label}</span>{children}</label>
}

// Texto que vira campo ao clicar (ou duplo clique). Enter salva, Esc cancela, sair do campo salva.
export function InlineText({ value, onSave, className = '', label, trigger = 'click', placeholder, children }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef(null)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => {
    if (!editing || !ref.current) return
    ref.current.focus()
    ref.current.select()
    grow(ref.current)
  }, [editing])

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) onSave(next)
  }

  if (editing) {
    return (
      <textarea ref={ref} className={`inline-edit ${className}`} value={draft} rows={1} aria-label={label}
        onChange={(e) => { setDraft(e.target.value); grow(e.target) }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(value); setEditing(false) }
        }} />
    )
  }
  const start = (e) => { e.stopPropagation(); setEditing(true) }
  return (
    <span className={`inline-view ${className}`} role="button" tabIndex={0} title={trigger === 'dblclick' ? 'Duplo clique para editar' : 'Clique para editar'}
      onClick={trigger === 'click' ? start : undefined} onDoubleClick={trigger === 'dblclick' ? start : undefined}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setEditing(true) } }}>
      {children || value || <em className="muted">{placeholder}</em>}
    </span>
  )
}

function grow(el) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function DateInput({ value, onChange, min, max, shortcuts = false, compact = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const set = (v) => { setOpen(false); if ((v || null) !== (value || null)) onChange(v || null) }
  return (
    <span className={`cd-date ${compact ? 'compact' : ''}`} ref={ref}>
      <input type="date" value={value || ''} min={min || undefined} max={max || undefined}
        onChange={(e) => set(e.target.value)} aria-label="Data" />
      {shortcuts && (
        <button type="button" className="cd-date-more" aria-label="Atalhos de data" onClick={() => setOpen(!open)}>
          <Icon name="chevron" />
        </button>
      )}
      {open && (
        <span className="dropdown-menu cd-date-menu">
          {dateShortcuts(todayIso()).map((s) => (
            <button key={s.key} type="button" onClick={() => set(s.date)}>{s.label}<small>{shortDate(s.date)}</small></button>
          ))}
          {value && <button type="button" className="danger" onClick={() => set(null)}>Remover data</button>}
        </span>
      )}
    </span>
  )
}

function ChipPicker({ options, selected, onToggle, empty, addLabel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const chosen = options.filter((o) => selected.includes(o.id))
  return (
    <div className="cd-chips" ref={ref}>
      {chosen.length === 0 && <span className="cd-empty">{empty}</span>}
      {chosen.map((o) => (
        <span key={o.id} className="cd-chip">
          {o.node}<span className="truncate">{o.label}</span>
          <button type="button" aria-label={`Remover ${o.label}`} onClick={() => onToggle(o.id)}><Icon name="close" /></button>
        </span>
      ))}
      <button type="button" className="cd-chip cd-chip-add" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="plus" />{addLabel}
      </button>
      {open && (
        <div className="dropdown-menu cd-pick">
          {options.length === 0 && <p className="cd-empty">Nada para escolher.</p>}
          {options.map((o) => (
            <label key={o.id} className="check-row">
              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
              {o.node}<span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function Description({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef(null)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  const save = () => { setEditing(false); if (draft !== value) onSave(draft) }
  if (editing) {
    return (
      <div className="cd-desc-edit">
        <textarea ref={ref} value={draft} rows={8} placeholder="Escreva em Markdown…" aria-label="Descrição"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false) }
          }} />
        <div className="cd-actions">
          <small className="muted">Markdown · Ctrl+Enter salva · Esc cancela</small>
          <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancelar</button>
          <button className="btn btn-primary" type="button" onClick={save}>Salvar</button>
        </div>
      </div>
    )
  }
  return (
    <div className="cd-desc" role="button" tabIndex={0} title="Clique para editar"
      onClick={(e) => { if (!e.target.closest('a')) setEditing(true) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true) } }}>
      {value
        ? <Suspense fallback={<p className="cd-pre">{value}</p>}><Markdown source={value} /></Suspense>
        : <p className="cd-empty">Sem descrição. Clique para escrever.</p>}
    </div>
  )
}

function NewChecklist({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [nome, setNome] = useState('')
  if (!open) return <button className="link-btn cd-link" type="button" onClick={() => setOpen(true)}><Icon name="plus" />Nova checklist</button>
  const submit = () => { if (nome.trim()) onAdd(nome.trim()); setNome(''); setOpen(false) }
  return (
    <span className="cd-new-list">
      <input autoFocus value={nome} placeholder="Nome da checklist" maxLength={100} onChange={(e) => setNome(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
        }} />
    </span>
  )
}

function Checklist({ checklist, people, membros, focus, onSave, onRemove, onAdd }) {
  const [hideDone, setHideDone] = useState(false)
  const [texto, setTexto] = useState('')
  const [adding, setAdding] = useState(false)
  const done = checklist.itens.filter((i) => i.feito).length
  const total = checklist.itens.length
  const itens = hideDone ? checklist.itens.filter((i) => !i.feito || i.id === focus) : checklist.itens

  async function add() {
    if (!texto.trim() || adding) return
    setAdding(true)
    if (await onAdd({ texto: texto.trim() })) setTexto('')
    setAdding(false)
  }

  return (
    <div className="cd-checklist">
      <div className="cd-cl-head">
        <strong className="truncate">{checklist.nome}</strong>
        <span className="gt-n">{done}/{total}</span>
        {done > 0 && (
          <button className="link-btn" type="button" onClick={() => setHideDone(!hideDone)}>
            {hideDone ? 'Mostrar marcados' : 'Ocultar marcados'}
          </button>
        )}
      </div>
      <div className="cd-progress"><span style={{ width: `${total ? (100 * done) / total : 0}%` }} /></div>
      <ul className="cd-items">
        {itens.map((item) => (
          <li key={item.id} className={`cd-item ${item.feito ? 'done' : ''}`} data-item={item.id}>
            <button type="button" className="cd-check" aria-pressed={item.feito}
              aria-label={item.feito ? 'Desmarcar item' : 'Marcar item como feito'}
              onClick={() => onSave(item, { feito: !item.feito }, { text: item.feito ? 'Item reaberto.' : 'Item concluído.', undo: true })}>
              <Icon name={item.feito ? 'item' : 'circle'} />
            </button>
            <div className="cd-item-main">
              <InlineText className="cd-item-text" value={item.texto} label="Texto do item"
                onSave={(t) => onSave(item, { texto: t }, { text: 'Item salvo.', undo: true })} />
              <div className="cd-item-meta">
                <select className="cd-owner" value={item.responsavelId || ''} aria-label="Responsável"
                  onChange={(e) => onSave(item, { responsavelId: e.target.value || null }, { text: 'Responsável alterado.', undo: true })}>
                  <option value="">Sem responsável</option>
                  {membros.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
                {item.responsavelId && people.get(item.responsavelId) && <Avatar pessoa={people.get(item.responsavelId)} size={18} />}
                <span className="cd-item-dates">
                  <DateInput compact value={item.dataInicio} max={item.dataFim}
                    onChange={(v) => onSave(item, { dataInicio: v }, { text: 'Início do item alterado.', undo: true })} />
                  <span className="muted">→</span>
                  <DateInput compact shortcuts value={item.dataFim} min={item.dataInicio}
                    onChange={(v) => onSave(item, { dataFim: v }, { text: v ? `Prazo do item: ${shortDate(v)}.` : 'Prazo do item removido.', undo: true })} />
                </span>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-icon cd-remove" aria-label="Remover item" title="Remover item"
              onClick={() => onRemove(item)}>
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <div className="cd-add-item">
        <input value={texto} placeholder="Adicionar item… (Enter)" maxLength={500} disabled={adding}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add() }
            if (e.key === 'Escape' && texto) { e.preventDefault(); e.stopPropagation(); setTexto('') }
          }} />
        <button className="btn btn-ghost" type="button" disabled={!texto.trim() || adding} onClick={add}>
          <Icon name="plus" />Adicionar
        </button>
      </div>
    </div>
  )
}

const WHEN = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Comments({ cardId, data, setData, onChange }) {
  const { toast } = useToast()
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const setList = (fn) => setData((d) => ({ ...d, comentarios: fn(d.comentarios) }))

  async function add() {
    if (!texto.trim() || busy) return
    setBusy(true)
    try {
      const c = await cardApi.addComment(cardId, texto.trim())
      setList((list) => [c, ...list])
      setTexto('')
      onChange()
    } catch (err) {
      toast({ text: err.message, tone: 'bad' })
    }
    setBusy(false)
  }

  async function edit(c, novo) {
    setList((list) => list.map((x) => (x.id === c.id ? { ...x, texto: novo, editado: true } : x)))
    try {
      await cardApi.editComment(cardId, c.id, novo)
      onChange()
    } catch (err) {
      setList((list) => list.map((x) => (x.id === c.id ? c : x)))
      toast({ text: err.message, tone: 'bad' })
    }
  }

  async function remove(c) {
    if (!window.confirm('Excluir este comentário? Não dá para desfazer.')) return
    setList((list) => list.filter((x) => x.id !== c.id))
    try {
      await cardApi.deleteComment(cardId, c.id)
      onChange()
      toast({ text: 'Comentário excluído.', tone: 'good' })
    } catch (err) {
      setList((list) => [c, ...list].sort((a, b) => (b.data || '').localeCompare(a.data || '')))
      toast({ text: err.message, tone: 'bad' })
    }
  }

  return (
    <div className="cd-comments">
      <div className="cd-new-comment">
        <textarea value={texto} rows={2} placeholder="Escreva um comentário… (Ctrl+Enter envia)" disabled={busy}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add() }
            if (e.key === 'Escape' && texto) { e.preventDefault(); e.stopPropagation(); setTexto('') }
          }} />
        {texto.trim() && (
          <div className="cd-actions">
            <button className="btn btn-primary" type="button" disabled={busy} onClick={add}>{busy ? 'Enviando…' : 'Comentar'}</button>
          </div>
        )}
      </div>
      {data.comentarios.length === 0 && <p className="cd-empty">Nenhum comentário ainda.</p>}
      <ul className="cd-comment-list">
        {data.comentarios.map((c) => {
          const mine = c.autor?.id && c.autor.id === data.euId
          return (
            <li key={c.id} className="cd-comment">
              <Avatar pessoa={c.autor} size={26} />
              <div className="cd-comment-main">
                <div className="cd-comment-head">
                  <strong>{c.autor?.nome}</strong>
                  <small className="muted">{c.data ? WHEN.format(new Date(c.data)) : ''}{c.editado ? ' · editado' : ''}</small>
                  {mine && (
                    <button className="link-btn" type="button" onClick={() => remove(c)}>Excluir</button>
                  )}
                </div>
                {mine
                  ? <InlineText className="cd-comment-text" value={c.texto} label="Editar comentário" onSave={(t) => edit(c, t)} />
                  : <p className="cd-comment-text">{c.texto}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
