import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import MarkdownView from './Markdown.jsx'
import { buildHtmlDoc } from './HtmlFlow.jsx'
import { MermaidEnv, renderSvg } from './Mermaid.jsx'
import { Icon } from './ui.jsx'

// Exportacao em PDF pela impressao do navegador: o processo e montado num iframe
// invisivel com os mesmos estilos do sistema (tema claro) e o usuario escolhe
// "Salvar como PDF". Texto e diagramas Mermaid saem vetoriais.

const KEY = 'produzia.processos.pdf'
const MM = 96 / 25.4
// Area util da folha A4 em px CSS (margens 12mm nas laterais/topo e 16mm embaixo).
const PAGE = {
  port: { w: Math.floor(186 * MM), h: Math.floor(269 * MM) - 6 },
  land: { w: Math.floor(273 * MM), h: Math.floor(182 * MM) - 6 },
}
const FLOW_HEAD = 46 // cabecalho "Fluxograma" de cada pagina
const MIN_SCALE = 0.5 // abaixo disso o fluxograma e dividido em varias paginas
const MAX_UP = 1.5 // diagrama pequeno pode crescer um pouco (e vetor)

function readPrefs() {
  try { return { orient: 'auto', order: 'flow', cover: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { orient: 'auto', order: 'flow', cover: true } }
}

const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const cssString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`
const nextFrame = (win) => new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => r())))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* Dialogo                                                              */
/* ------------------------------------------------------------------ */

const KINDS = [
  { key: 'flow', title: 'Fluxograma', text: 'O diagrama ajustado à folha, em retrato ou paisagem' },
  { key: 'doc', title: 'Documento', text: 'O texto com títulos, tabelas e checklists' },
  { key: 'both', title: 'Os dois juntos', text: 'Documento e fluxograma num só arquivo' },
]

export function ExportPdfDialog({ p, initial, onClose }) {
  const has = { doc: !!p.markdown?.trim(), flow: !!p.fluxograma?.trim() }
  has.both = has.doc && has.flow
  const [kind, setKind] = useState(has[initial] ? initial : has.both ? 'both' : has.flow ? 'flow' : 'doc')
  const [prefs, setPrefs] = useState(readPrefs)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const panel = useRef(null)

  const set = (k, v) => setPrefs((s) => {
    const next = { ...s, [k]: v }
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* sem storage */ }
    return next
  })

  useEffect(() => {
    panel.current?.querySelector('.px-kind.on')?.focus()
    const onKey = (e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  async function run(e) {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await printProcess(p, { kind, ...prefs })
      onClose()
    } catch (err) {
      setError(err?.message || 'Não deu para gerar o PDF.')
      setBusy(false)
    }
  }

  const withFlow = kind !== 'doc'

  return (
    <div className="px-overlay" role="dialog" aria-modal="true" aria-label="Exportar PDF"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <form className="px-panel" ref={panel} onSubmit={run}>
        <header className="px-head">
          <div>
            <h2>Exportar PDF</h2>
            <p className="truncate">{p.nome}</p>
          </div>
          <button className="btn btn-ghost btn-icon" type="button" title="Fechar (Esc)" onClick={onClose} disabled={busy}><Icon name="close" /></button>
        </header>

        <div className="px-kinds" role="radiogroup" aria-label="O que exportar">
          {KINDS.map((k) => (
            <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} disabled={!has[k.key]}
              className={`px-kind ${kind === k.key ? 'on' : ''}`} onClick={() => setKind(k.key)}
              onDoubleClick={() => has[k.key] && run()}>
              <Sheet kind={k.key} land={k.key !== 'doc' && prefs.orient === 'land'} />
              <strong>{k.title}</strong>
              <span>{has[k.key] ? k.text : k.key === 'doc' ? 'Este processo não tem documento' : k.key === 'flow' ? 'Este processo não tem fluxograma' : 'Precisa de documento e fluxograma'}</span>
              <i className="px-tick"><Icon name="check" /></i>
            </button>
          ))}
        </div>

        <div className="px-opts">
          {withFlow && (
            <div className="px-opt">
              <span>Folha do fluxograma</span>
              <div className="segmented segmented-sm" role="radiogroup" aria-label="Orientação do fluxograma">
                {[['auto', 'Automática'], ['port', 'Retrato'], ['land', 'Paisagem']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={prefs.orient === v}
                    className={prefs.orient === v ? 'active' : ''} onClick={() => set('orient', v)}>{l}</button>
                ))}
              </div>
            </div>
          )}
          {kind === 'both' && (
            <div className="px-opt">
              <span>Ordem</span>
              <div className="segmented segmented-sm" role="radiogroup" aria-label="Ordem">
                {[['flow', 'Fluxograma primeiro'], ['doc', 'Documento primeiro']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={prefs.order === v}
                    className={prefs.order === v ? 'active' : ''} onClick={() => set('order', v)}>{l}</button>
                ))}
              </div>
            </div>
          )}
          <label className="px-check">
            <input type="checkbox" checked={prefs.cover} onChange={(e) => set('cover', e.target.checked)} />
            Cabeçalho com categoria, resumo, quadro e data
          </label>
        </div>

        {error && <p className="form-error"><Icon name="warning" />{error}</p>}

        <footer className="px-foot">
          <span className="px-tip"><Icon name="print" />Na janela de impressão, escolha <strong>Salvar como PDF</strong>.</span>
          <span className="tc-spacer" />
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <><span className="spinner" />Preparando…</> : <><Icon name="download" />Gerar PDF</>}
          </button>
        </footer>
      </form>
    </div>
  )
}

/** Miniatura da folha para cada opcao. */
function Sheet({ kind, land }) {
  const doc = (
    <>
      <i className="l w60 strong" /><i className="l w90" /><i className="l w80" /><i className="l w40 strong" /><i className="l w90" /><i className="l w70" />
    </>
  )
  const flow = (
    <span className="px-mini-flow"><i /><b /><i className="d" /><b /><i /></span>
  )
  if (kind === 'both') {
    return (
      <span className="px-sheets">
        <span className={`px-sheet ${land ? 'land' : ''} back`}>{flow}</span>
        <span className="px-sheet front">{doc}</span>
      </span>
    )
  }
  return <span className="px-sheets"><span className={`px-sheet ${land ? 'land' : ''}`}>{kind === 'doc' ? doc : flow}</span></span>
}

/* ------------------------------------------------------------------ */
/* Montagem e impressao                                                 */
/* ------------------------------------------------------------------ */

function printCss(p) {
  const footer = cssString(`${p.nome} · Produzia`)
  return `
@page { size: A4 portrait; margin: 12mm 12mm 16mm;
  @bottom-left { content: ${footer}; font: 500 8.5pt Inter, system-ui, sans-serif; color: #94a3b8; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 500 8.5pt Inter, system-ui, sans-serif; color: #94a3b8; }
}
@page land { size: A4 landscape; }
@page port { size: A4 portrait; }
*, *::before, *::after { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root, body { margin: 0; background: var(--surface); }
body { font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--ink); }
@media screen { body { width: ${PAGE.port.w}px; } }
`
}

/** Monta o processo num iframe invisivel e abre a impressao dele. */
export async function printProcess(p, opts) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  Object.assign(iframe.style, {
    position: 'fixed', left: '-12000px', top: '0', width: `${PAGE.land.w + 40}px`, height: '900px', border: '0', opacity: '0', pointerEvents: 'none',
  })
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  const doc = iframe.contentDocument
  const title = p.nome
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => {
    if (n.tagName === 'LINK') return `<link rel="stylesheet" href="${n.href}">`
    return n.outerHTML
  }).join('')
  doc.open()
  doc.write(`<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><title></title>${styles}<style>${printCss(p)}</style></head><body><div id="px-root"></div></body></html>`)
  doc.close()
  doc.title = title

  let root
  const oldTitle = document.title
  try {
    await Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => (l.sheet ? null : new Promise((r) => {
      l.addEventListener('load', r, { once: true })
      l.addEventListener('error', r, { once: true })
      setTimeout(r, 5000)
    }))))

    const jobs = []
    const env = { root: doc.documentElement, win, track: (job) => { jobs.push(job) } }
    root = createRoot(doc.getElementById('px-root'))
    root.render(<MermaidEnv.Provider value={env}><PrintDoc p={p} opts={opts} env={env} /></MermaidEnv.Provider>)

    // Espera tudo desenhar: cada parte assincrona registra uma promessa em env.track.
    const deadline = Date.now() + 20000
    await nextFrame(win)
    let seen = -1
    while (seen !== jobs.length && Date.now() < deadline) {
      seen = jobs.length
      await Promise.race([Promise.allSettled(jobs.slice()), wait(Math.max(0, deadline - Date.now()))])
      await nextFrame(win)
    }
    await Promise.race([doc.fonts?.ready, wait(3000)])
    await nextFrame(win)

    document.title = title // o Chrome sugere o nome do arquivo pelo titulo
    win.focus()
    await new Promise((resolve) => {
      let done = false
      const finish = () => { if (!done) { done = true; resolve() } }
      win.addEventListener('afterprint', finish, { once: true })
      win.print() // bloqueia ate a janela fechar na maioria dos navegadores
      setTimeout(finish, 400)
    })
  } finally {
    // Da tempo ao navegador de terminar o PDF antes de remover o iframe.
    setTimeout(() => {
      document.title = oldTitle
      root?.unmount()
      iframe.remove()
    }, 1500)
  }
}

function PrintDoc({ p, opts, env }) {
  const parts = opts.kind === 'both' ? (opts.order === 'doc' ? ['doc', 'flow'] : ['flow', 'doc']) : [opts.kind]
  return (
    <div className="px-print">
      {parts.map((part, i) => (part === 'doc'
        ? <DocPart key="doc" p={p} cover={opts.cover && i === 0} breakBefore={i > 0} />
        : <FlowPart key="flow" p={p} cover={opts.cover && i === 0} orient={opts.orient} env={env} breakBefore={i > 0} />))}
    </div>
  )
}

function Cover({ p, coverRef }) {
  return (
    <header className="px-cover" ref={coverRef}>
      <div className="px-brand"><span className="px-logo" />Produzia <span>· Mapeamento de processos</span></div>
      {p.categoria && <span className="pc-cat">{p.categoria}</span>}
      <h1>{p.nome}</h1>
      {p.descricao && <p>{p.descricao}</p>}
      <div className="pc-meta">
        <span><Icon name="board" />{p.quadroNome || 'Quadro removido'}</span>
        <span><Icon name="clock" />Atualizado em {fmtDate(p.atualizadoEm)}</span>
        <span><Icon name="download" />Exportado em {fmtDate(Date.now())}</span>
      </div>
    </header>
  )
}

function DocPart({ p, cover, breakBefore }) {
  return (
    <section className={`px-doc ${breakBefore ? 'px-break' : ''}`}>
      {cover && <Cover p={p} />}
      {!cover && <div className="px-sec-head"><Icon name="doc" />Documento<span>{p.nome}</span></div>}
      <MarkdownView source={p.markdown} />
    </section>
  )
}

/* ---- Fluxograma: escolhe a folha, a escala e, se preciso, divide em paginas ---- */

function plan({ orient, measure, reserve }) {
  const choices = (orient === 'auto' ? ['land', 'port'] : [orient]).map((o) => {
    const { w, h, max } = measure(o)
    const W = PAGE[o].w
    const H = PAGE[o].h - reserve
    return { o, w, h, s: Math.min(W / w, H / h, max) }
  })
  const best = choices.reduce((a, b) => (b.s > a.s + 0.02 ? b : a))
  if (best.s >= MIN_SCALE) return { o: best.o, s: best.s, w: best.w, h: best.h, slices: [[0, best.h]] }

  // Grande demais para uma folha: ocupa a largura e divide na altura.
  const o = orient === 'auto' ? (best.h > best.w ? 'port' : 'land') : orient
  const { w, h, max } = measure(o)
  const s = Math.min(PAGE[o].w / w, max)
  const slices = []
  let y = 0
  while (y < h - 1) {
    const room = (PAGE[o].h - (slices.length ? FLOW_HEAD : reserve)) / s
    slices.push([y, Math.min(h, y + room)])
    y += room
  }
  return { o, s, w, h, slices }
}

function FlowPart({ p, cover, orient, env, breakBefore }) {
  const html = p.fluxogramaTipo === 'html'
  const coverRef = useRef(null)
  const [layout, setLayout] = useState(null)
  const [error, setError] = useState(null)
  const done = useRef(null)
  if (!done.current) {
    let resolve
    done.current = { promise: new Promise((r) => { resolve = r }), resolve }
    env.track(done.current.promise)
  }

  useEffect(() => {
    let alive = true
    const reserve = (coverRef.current?.offsetHeight || 0) + (cover ? 22 : FLOW_HEAD)
    const work = html ? layoutHtml(p.fluxograma, orient, reserve, env) : layoutMermaid(p.fluxograma, orient, reserve, env)
    work.then((l) => alive && setLayout(l)).catch((e) => {
      if (!alive) return
      setError(String(e?.message || e))
      done.current.resolve()
    })
    return () => { alive = false }
  }, [p.fluxograma, html, orient, cover, env])

  const total = layout?.slices.length || 1
  const pages = layout ? layout.slices : [[0, 0]]
  return (
    <>
      {pages.map(([y0, y1], i) => (
        <section key={i} className={`px-flow px-${layout?.o || 'port'} ${breakBefore || i > 0 ? 'px-break' : ''}`}>
          {i === 0 && cover && <Cover p={p} coverRef={coverRef} />}
          {(i > 0 || !cover) && (
            <div className="px-sec-head"><Icon name="flow" />Fluxograma
              <span>{p.nome}{total > 1 ? ` · parte ${i + 1} de ${total}` : ''}</span>
            </div>
          )}
          {error && i === 0 && <p className="px-error">Não deu para desenhar o fluxograma: {error}</p>}
          {layout && (html
            ? <HtmlSlice code={p.fluxograma} layout={layout} y0={y0} y1={y1} onLoad={i === total - 1 ? done.current.resolve : null} />
            : <SvgSlice layout={layout} y0={y0} y1={y1} onLoad={i === total - 1 ? done.current.resolve : null} />)}
        </section>
      ))}
    </>
  )
}

async function layoutMermaid(code, orient, reserve, env) {
  const svg = await renderSvg(code.trim(), 'light', env.root)
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const [x, y, w, h] = (el.getAttribute('viewBox') || '0 0 800 600').split(/[\s,]+/).map(Number)
  const l = plan({ orient, reserve, measure: () => ({ w, h, max: MAX_UP }) })
  return { ...l, svg, vx: x, vy: y }
}

function SvgSlice({ layout, y0, y1, onLoad }) {
  const { s, w, svg, vx, vy } = layout
  const markup = useMemo(() => {
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    el.setAttribute('viewBox', `${vx} ${vy + y0} ${w} ${y1 - y0}`)
    el.setAttribute('width', String(w * s))
    el.setAttribute('height', String((y1 - y0) * s))
    el.style.removeProperty('max-width')
    return new XMLSerializer().serializeToString(el)
  }, [svg, vx, vy, w, s, y0, y1])
  useEffect(() => { onLoad?.() }, [onLoad])
  // SVG do mermaid com securityLevel strict (sanitizado pelo DOMPurify interno).
  return <div className="px-figure" style={{ width: w * s, height: (y1 - y0) * s }} dangerouslySetInnerHTML={{ __html: markup }} />
}

const FLOW_PRINT_CSS = '*,*::before,*::after{-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{overflow:hidden}'

/** Desenha o HTML num iframe isolado com a largura dada e devolve o tamanho real. */
function measureHtml(code, width, env) {
  return new Promise((resolve) => {
    const doc = env.root.ownerDocument
    const frame = doc.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    Object.assign(frame.style, { position: 'absolute', left: '-20000px', top: '0', width: `${width}px`, height: '40px', border: '0' })
    let last = { w: width, h: 160 }
    let timer
    const finish = () => {
      clearTimeout(timer)
      clearTimeout(cap)
      env.win.removeEventListener('message', onMessage)
      frame.remove()
      resolve({ w: Math.max(width, last.w), h: Math.max(40, last.h) })
    }
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || !e.data?.produziaFluxo) return
      last = { w: Number(e.data.largura) || width, h: Number(e.data.altura) || last.h }
      clearTimeout(timer)
      timer = setTimeout(finish, 700) // espera fontes e ajustes de layout
    }
    const cap = setTimeout(finish, 6000)
    env.win.addEventListener('message', onMessage)
    frame.srcdoc = buildHtmlDoc(code, 'light', FLOW_PRINT_CSS)
    doc.body.appendChild(frame)
  })
}

async function layoutHtml(code, orient, reserve, env) {
  // O HTML se reorganiza conforme a largura: mede na largura de cada folha.
  const sizes = {}
  for (const o of orient === 'auto' ? ['land', 'port'] : [orient]) sizes[o] = await measureHtml(code, PAGE[o].w, env)
  const measure = (o) => ({ ...(sizes[o] || sizes[Object.keys(sizes)[0]]), max: 1 })
  const l = plan({ orient, reserve, measure })
  return { ...l, layoutWidth: PAGE[l.o].w }
}

function HtmlSlice({ code, layout, y0, y1, onLoad }) {
  const { s, w, h, layoutWidth } = layout
  const srcDoc = useMemo(() => buildHtmlDoc(code, 'light', FLOW_PRINT_CSS), [code])
  return (
    <div className="px-figure" style={{ width: w * s, height: (y1 - y0) * s }}>
      <iframe title="Fluxograma" sandbox="allow-scripts" srcDoc={srcDoc} tabIndex={-1}
        onLoad={onLoad ? () => setTimeout(onLoad, 600) : undefined}
        style={{ width: Math.max(w, layoutWidth), height: h, transform: `scale(${s}) translateY(${-y0}px)` }} />
    </div>
  )
}
