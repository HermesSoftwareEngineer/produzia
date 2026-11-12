import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { useBoards } from '../boards.jsx'
import MarkdownView from '../components/Markdown.jsx'
import HtmlFlow from '../components/HtmlFlow.jsx'
import MermaidDiagram from '../components/Mermaid.jsx'
import { Empty, ErrorBox, Icon, Loading } from '../components/ui.jsx'
import { MODELO_FLUXO_HTML } from '../fluxoModeloHtml.js'

const KEY = 'produzia.processos.quadro'
const MAX_MD = 200 * 1024
const MAX_FLOW = 50 * 1024
const MAX_FLOW_HTML = 300 * 1024
const SEM_CATEGORIA = 'Sem categoria'

const MODELO_FLUXO = `flowchart TD
    inicio([Início]) --> receber[Receber a solicitação]
    receber --> completa{Está completa?}
    completa -->|Sim| executar[Executar a atividade]
    completa -->|Não| ajustar[Pedir ajustes ao solicitante]
    ajustar --> receber
    executar --> revisar[Revisar e registrar no Trello]
    revisar --> fim([Fim])
`

const MODELO_DOC = `## Objetivo

Descreva em uma frase o resultado que este processo entrega.

## Responsáveis

| Papel | Pessoa |
|---|---|
| Dono do processo | |
| Executor | |

## Etapas

1. Receber a solicitação
2. Conferir as informações
3. Executar a atividade
4. Registrar no Trello

## Checklist

- [ ] Informações conferidas
- [ ] Atividade concluída
- [ ] Card movido para Concluído
`

function readBoard() {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
function ago(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of units) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit)
  }
  return 'agora'
}
const author = (p) => (p.atualizadoPor === 'mcp' ? 'via MCP' : 'pela web')
const kb = (text) => Math.ceil(new Blob([text || '']).size / 1024)

export default function Processos() {
  const { boards, loaded } = useBoards()
  const [params, setParams] = useSearchParams()
  const [quadro, setQuadroState] = useState(readBoard)
  const [list, setList] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState('doc')
  const [editing, setEditing] = useState(null) // null | {} (novo) | processo
  const [version, setVersion] = useState(0)
  const selectedId = params.get('p')

  const board = boards.some((b) => b.id === quadro) ? quadro : ''
  const setQuadro = (id) => {
    setQuadroState(id)
    try { localStorage.setItem(KEY, id) } catch { /* sem storage */ }
  }
  const select = (id) => setParams(id ? { p: id } : {}, { replace: true })

  useEffect(() => {
    if (!loaded) return undefined
    let alive = true
    api(`/processos${board ? `?quadro=${board}` : ''}`)
      .then((d) => alive && (setList(d.processos), setError(null)))
      .catch((e) => alive && setError(e))
    return () => { alive = false }
  }, [board, version, loaded])

  // Mantem a selecao dentro da lista visivel.
  useEffect(() => {
    if (!list) return
    const first = list[0]?.id || null
    if (!list.some((p) => p.id === selectedId) && first !== selectedId) select(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, selectedId])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined }
    let alive = true
    api(`/processos/${selectedId}`)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && (setDetail(null), setError(e)))
    return () => { alive = false }
  }, [selectedId, version])

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    const out = new Map()
    for (const p of list || []) {
      const hay = `${p.nome} ${p.descricao} ${p.categoria || ''}`.toLowerCase()
      if (term && !hay.includes(term)) continue
      const key = p.categoria || SEM_CATEGORIA
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(p)
    }
    return [...out.entries()]
  }, [list, search])

  const categories = useMemo(() => [...new Set((list || []).map((p) => p.categoria).filter(Boolean))], [list])

  if (loaded && !boards.length) {
    return <Empty title="Nenhum quadro cadastrado">Cadastre um quadro em <Link to="/quadros">Quadros</Link> para mapear os processos dele.</Empty>
  }

  async function remove(p) {
    if (!window.confirm(`Excluir o processo "${p.nome}"? Essa ação não pode ser desfeita.`)) return
    try {
      await api(`/processos/${p.id}`, { method: 'DELETE' })
      select(null)
      setDetail(null)
      setVersion((v) => v + 1)
    } catch (e) {
      setError(e)
    }
  }

  function saved(p) {
    setEditing(null)
    if (board && p.quadroId !== board) setQuadro(p.quadroId)
    // Entra na lista ja, para a selecao nao voltar ao primeiro item antes do recarregamento.
    setList((l) => [...(l || []).filter((x) => x.id !== p.id), p])
    select(p.id)
    setDetail(p)
    setVersion((v) => v + 1)
  }

  const visible = detail && detail.id === selectedId ? detail : null
  const total = list?.length || 0

  return (
    <div className="page pc">
      <div className="pc-head">
        <label className="pc-board">
          <Icon name="board" />
          <select value={board} onChange={(e) => setQuadro(e.target.value)} aria-label="Quadro">
            <option value="">Todos os quadros</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
          <Icon name="chevron" className="pc-caret" />
        </label>
        {list && <span className="muted small">{total} {total === 1 ? 'processo' : 'processos'}</span>}
        <button className="btn btn-primary pc-new" type="button" onClick={() => setEditing({})}>
          <Icon name="plus" />Novo processo
        </button>
      </div>

      <ErrorBox error={error} />

      {list === null ? <Loading text="Carregando processos…" /> : !total ? (
        <EmptyState onCreate={() => setEditing({})} />
      ) : (
        <div className="pc-body">
          <aside className="pc-list">
            <div className="search">
              <Icon name="search" />
              <input placeholder="Buscar processo" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {!groups.length && <p className="feed-empty">Nada encontrado para “{search}”.</p>}
            {groups.map(([cat, items]) => (
              <section key={cat} className="pc-group">
                <h4>{cat}<span>{items.length}</span></h4>
                <ul>
                  {items.map((p) => (
                    <li key={p.id}>
                      <button type="button" className={p.id === selectedId ? 'active' : ''} onClick={() => select(p.id)}>
                        <span className="pc-item-name">{p.nome}</span>
                        {p.descricao && <span className="pc-item-desc">{p.descricao}</span>}
                        <span className="pc-item-meta">
                          {p.temDocumento && <Icon name="doc" />}
                          {p.temFluxograma && <Icon name="flow" />}
                          {!board && <span className="truncate">{p.quadroNome || 'Quadro removido'}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </aside>

          <section className="pc-view">
            {visible
              ? <ProcessView key={visible.id} p={visible} mode={mode} setMode={setMode}
                  onEdit={() => setEditing(visible)} onDelete={() => remove(visible)} />
              : <Loading text="Abrindo processo…" />}
          </section>
        </div>
      )}

      {editing && (
        <Editor initial={editing} boards={boards} defaultBoard={board || boards[0]?.id}
          categories={categories} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </div>
  )
}

function EmptyState({ onCreate }) {
  return (
    <div className="pc-empty">
      <span className="pc-empty-icon"><Icon name="flow" /></span>
      <h3>Nenhum processo mapeado ainda</h3>
      <p>
        Documente como o trabalho acontece em cada quadro: um texto em Markdown com etapas, responsáveis
        e checklists, e um fluxograma (em Mermaid ou em HTML livre) que mostra o caminho de ponta a ponta.
      </p>
      <button className="btn btn-primary" type="button" onClick={onCreate}><Icon name="plus" />Criar o primeiro processo</button>
      <p className="pc-empty-mcp">
        Também dá para criar pelo <strong>MCP do Produzia</strong>: conecte um agente de IA (como o Claude Code)
        e peça, por exemplo, <em>“mapeie o processo de compras do quadro Obras com um fluxograma”</em>.
      </p>
    </div>
  )
}

function ProcessView({ p, mode, setMode, onEdit, onDelete }) {
  const modes = [
    p.markdown && { key: 'doc', icon: 'doc', label: 'Documento' },
    p.fluxograma && { key: 'flow', icon: 'flow', label: 'Fluxograma' },
    p.markdown && p.fluxograma && { key: 'side', icon: 'split', label: 'Lado a lado' },
  ].filter(Boolean)
  const current = modes.some((m) => m.key === mode) ? mode : modes[0].key

  return (
    <article className="pc-process">
      <header className="pc-title">
        <div className="pc-title-text">
          {p.categoria && <span className="pc-cat">{p.categoria}</span>}
          <h2>{p.nome}</h2>
          {p.descricao && <p>{p.descricao}</p>}
          <div className="pc-meta">
            <span><Icon name="board" />{p.quadroNome || 'Quadro removido'}</span>
            <span title={new Date(p.atualizadoEm).toLocaleString('pt-BR')}>
              <Icon name="clock" />atualizado {ago(p.atualizadoEm)} {author(p)}
            </span>
          </div>
        </div>
        <div className="pc-actions">
          <button className="btn btn-ghost" type="button" onClick={onEdit}><Icon name="edit" />Editar</button>
          <button className="btn btn-ghost btn-icon danger" type="button" title="Excluir" onClick={onDelete}><Icon name="trash" /></button>
        </div>
      </header>

      {modes.length > 1 && (
        <div className="tabs pc-tabs" role="tablist">
          {modes.map((m) => (
            <button key={m.key} type="button" role="tab" aria-selected={current === m.key}
              className={current === m.key ? 'active' : ''} onClick={() => setMode(m.key)}>
              <Icon name={m.icon} />{m.label}
            </button>
          ))}
        </div>
      )}

      <div className={`pc-content pc-${current}`}>
        {(current === 'doc' || current === 'side') && <MarkdownView source={p.markdown} />}
        {(current === 'flow' || current === 'side') && (
          <div className="pc-flow">
            {p.fluxogramaTipo === 'html'
              ? <HtmlFlow code={p.fluxograma} name={p.nome} />
              : <MermaidDiagram code={p.fluxograma} name={p.nome} />}
          </div>
        )}
      </div>
    </article>
  )
}

function stripFence(text) {
  const m = text.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/)
  return m ? m[1] : text
}

function Editor({ initial, boards, defaultBoard, categories, onClose, onSaved }) {
  const isNew = !initial.id
  const start = useMemo(() => ({
    quadroId: initial.quadroId || defaultBoard || '',
    nome: initial.nome || '',
    descricao: initial.descricao || '',
    categoria: initial.categoria || '',
    markdown: initial.markdown || '',
    fluxograma: initial.fluxograma || '',
    fluxogramaTipo: initial.fluxogramaTipo || 'mermaid',
  }), [initial, defaultBoard])
  const [form, setForm] = useState(start)
  const [tab, setTab] = useState(initial.id && !initial.markdown && initial.fluxograma ? 'flow' : 'doc')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const deferredMd = useDeferredValue(form.markdown)
  const dirty = JSON.stringify(form) !== JSON.stringify(start)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const close = () => { if (!dirty || window.confirm('Descartar as alterações?')) onClose() }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const isHtml = form.fluxogramaTipo === 'html'

  function setFlowType(tipo) {
    if (tipo === form.fluxogramaTipo) return
    if (form.fluxograma.trim() && !window.confirm('Trocar o tipo apaga o fluxograma atual. Continuar?')) return
    setForm((f) => ({ ...f, fluxogramaTipo: tipo, fluxograma: '' }))
  }

  function insertTemplate() {
    const field = tab === 'doc' ? 'markdown' : 'fluxograma'
    const model = tab === 'doc' ? MODELO_DOC : isHtml ? MODELO_FLUXO_HTML : MODELO_FLUXO
    if (form[field].trim() && !window.confirm('Substituir o conteúdo atual pelo modelo?')) return
    setForm((f) => ({ ...f, [field]: model }))
  }

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isHtmlFile = /\.html?$/i.test(file.name)
    const isFlow = isHtmlFile || /\.(mmd|mermaid)$/i.test(file.name)
    const isDoc = /\.(md|markdown|txt)$/i.test(file.name)
    if (!isFlow && !isDoc) { setError('Envie .md (documento), .mmd/.mermaid ou .html (fluxograma).'); return }
    const limit = isHtmlFile ? MAX_FLOW_HTML : isFlow ? MAX_FLOW : MAX_MD
    if (file.size > limit) { setError(`Arquivo grande demais (máximo ${limit / 1024} KB).`); return }
    const text = await file.text()
    setError(null)
    if (isFlow) {
      setForm((f) => ({ ...f, fluxogramaTipo: isHtmlFile ? 'html' : 'mermaid', fluxograma: isHtmlFile ? text : stripFence(text) }))
      setTab('flow')
    }
    else {
      setForm((f) => ({ ...f, markdown: text, nome: f.nome || file.name.replace(/\.\w+$/, '') }))
      setTab('doc')
    }
  }

  function tabKey(e) {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const el = e.target
    el.setRangeText('    ', el.selectionStart, el.selectionEnd, 'end')
    set(el.name)({ target: el })
  }

  async function save(e) {
    e.preventDefault()
    if (!form.nome.trim()) { setError('Informe o nome do processo.'); return }
    if (!form.markdown.trim() && !form.fluxograma.trim()) { setError('Escreva o documento ou o fluxograma (pelo menos um).'); return }
    const flowMax = isHtml ? 300 : 50
    if (kb(form.markdown) > 200 || kb(form.fluxograma) > flowMax) { setError(`Conteúdo grande demais (documento até 200 KB, fluxograma até ${flowMax} KB).`); return }
    setBusy(true)
    setError(null)
    try {
      const body = { ...form }
      const p = isNew
        ? await api('/processos', { method: 'POST', body })
        : await api(`/processos/${initial.id}`, { method: 'PUT', body })
      onSaved(p)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="pc-modal" role="dialog" aria-modal="true" aria-label={isNew ? 'Novo processo' : 'Editar processo'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <form className="pc-editor" onSubmit={save}>
        <header className="pc-editor-head">
          <h2>{isNew ? 'Novo processo' : 'Editar processo'}</h2>
          <button className="btn btn-ghost btn-icon" type="button" title="Fechar (Esc)" onClick={close}><Icon name="close" /></button>
        </header>

        <div className="pc-fields">
          <label className="pc-field pc-field-name">
            <span>Nome</span>
            <input value={form.nome} onChange={set('nome')} maxLength={120} placeholder="Ex.: Compra de material" autoFocus />
          </label>
          <label className="pc-field">
            <span>Categoria</span>
            <input value={form.categoria} onChange={set('categoria')} maxLength={60} placeholder="Ex.: Comercial" list="pc-categorias" />
            <datalist id="pc-categorias">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="pc-field">
            <span>Quadro</span>
            <select value={form.quadroId} onChange={set('quadroId')}>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </label>
          <label className="pc-field pc-field-wide">
            <span>Resumo</span>
            <input value={form.descricao} onChange={set('descricao')} maxLength={500} placeholder="Uma frase sobre o que o processo resolve" />
          </label>
        </div>

        <div className="pc-editor-bar">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'doc'} className={tab === 'doc' ? 'active' : ''} onClick={() => setTab('doc')}>
              <Icon name="doc" />Documento{form.markdown.trim() && <span className="n">{kb(form.markdown)} KB</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'flow'} className={tab === 'flow' ? 'active' : ''} onClick={() => setTab('flow')}>
              <Icon name="flow" />Fluxograma{form.fluxograma.trim() && <span className="n">{kb(form.fluxograma)} KB</span>}
            </button>
          </div>
          <div className="pc-editor-tools">
            {tab === 'flow' && (
              <div className="segmented pc-flow-type" role="radiogroup" aria-label="Tipo do fluxograma">
                <button type="button" role="radio" aria-checked={!isHtml} className={!isHtml ? 'active' : ''}
                  onClick={() => setFlowType('mermaid')} title="Diagrama gerado a partir de texto">Mermaid</button>
                <button type="button" role="radio" aria-checked={isHtml} className={isHtml ? 'active' : ''}
                  onClick={() => setFlowType('html')} title="Visual livre em HTML e CSS">HTML</button>
              </div>
            )}
            <button className="link-btn" type="button" onClick={insertTemplate}>
              <Icon name="plus" />Inserir modelo
            </button>
            <button className="link-btn" type="button" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />Importar {tab === 'doc' ? '.md' : isHtml ? '.html' : '.mmd'}
            </button>
            <input ref={fileRef} type="file" hidden onChange={upload}
              accept={tab === 'doc' ? '.md,.markdown,.txt,text/markdown' : isHtml ? '.html,.htm,text/html' : '.mmd,.mermaid'} />
          </div>
        </div>

        <div className="pc-split">
          {tab === 'doc' ? (
            <>
              <textarea name="markdown" value={form.markdown} onChange={set('markdown')} onKeyDown={tabKey} spellCheck
                placeholder={'## Objetivo\n\nEscreva em Markdown: títulos, listas, tabelas e checklists (- [ ] item).'} />
              <div className="pc-preview">
                {deferredMd.trim() ? <MarkdownView source={deferredMd} /> : <p className="pc-preview-empty">A pré-visualização aparece aqui.</p>}
              </div>
            </>
          ) : (
            <>
              <textarea name="fluxograma" className="mono" value={form.fluxograma} onChange={set('fluxograma')} onKeyDown={tabKey}
                spellCheck={false}
                placeholder={isHtml
                  ? '<style>\n  .etapa { padding: 12px; border-radius: 12px; background: var(--pz-surface); }\n</style>\n<div class="etapa">Início</div>'
                  : 'flowchart TD\n    A[Início] --> B{Decisão?}\n    B -->|Sim| C[Fazer]\n    B -->|Não| D[Ajustar]'} />
              <div className="pc-preview">
                {form.fluxograma.trim() && isHtml && <HtmlFlow code={form.fluxograma} name={form.nome} toolbar={false} delay={400} />}
                {form.fluxograma.trim() && !isHtml && <MermaidDiagram code={form.fluxograma} name={form.nome} toolbar={false} delay={350} />}
                {!form.fluxograma.trim() && isHtml && (
                  <p className="pc-preview-empty">
                    Escreva HTML e CSS livres (as variáveis <code>--pz-brand</code>, <code>--pz-surface</code>, <code>--pz-line</code>…
                    seguem o tema) ou use <button className="link-inline" type="button" onClick={insertTemplate}>o modelo</button>.
                  </p>
                )}
                {!form.fluxograma.trim() && !isHtml && (
                    <p className="pc-preview-empty">
                      Escreva em <a href="https://mermaid.js.org/syntax/flowchart.html" target="_blank" rel="noreferrer">sintaxe Mermaid</a> ou
                      use <button className="link-inline" type="button" onClick={insertTemplate}>o modelo</button>.
                    </p>
                  )}
              </div>
            </>
          )}
        </div>

        <footer className="pc-editor-foot">
          {error && <p className="form-error"><Icon name="warning" />{error}</p>}
          <button className="btn btn-ghost" type="button" onClick={close}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : isNew ? 'Criar processo' : 'Salvar'}</button>
        </footer>
      </form>
    </div>
  )
}
