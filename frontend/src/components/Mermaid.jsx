import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTheme } from '../theme.jsx'
import { Icon } from './ui.jsx'

// O mermaid e grande: so carrega quando algum diagrama aparece na tela.
let loader
const loadMermaid = () => (loader ||= import('mermaid').then((m) => m.default))
let seq = 0

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function themeVariables(dark) {
  return {
    darkMode: dark,
    background: cssVar('--surface'),
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '14px',
    primaryColor: cssVar('--pc-node'),
    primaryBorderColor: cssVar('--pc-node-line'),
    primaryTextColor: cssVar('--ink'),
    secondaryColor: cssVar('--pc-node-2'),
    secondaryBorderColor: cssVar('--pc-node-2-line'),
    secondaryTextColor: cssVar('--ink'),
    tertiaryColor: cssVar('--pc-cluster'),
    tertiaryBorderColor: cssVar('--line'),
    tertiaryTextColor: cssVar('--ink'),
    lineColor: cssVar('--pc-edge'),
    textColor: cssVar('--ink'),
    clusterBkg: cssVar('--pc-cluster'),
    clusterBorder: cssVar('--line-strong'),
    edgeLabelBackground: cssVar('--surface'),
    noteBkgColor: cssVar('--warn-soft'),
    noteBorderColor: cssVar('--warn-line'),
    noteTextColor: cssVar('--ink'),
    actorBkg: cssVar('--pc-node'),
    actorBorder: cssVar('--pc-node-line'),
    actorTextColor: cssVar('--ink'),
    signalColor: cssVar('--pc-edge'),
    signalTextColor: cssVar('--ink'),
  }
}

async function renderSvg(code, theme) {
  const mermaid = await loadMermaid()
  // Le as cores depois do await: o tema novo ja foi aplicado no <html>.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(theme === 'dark'),
    // Rotulos em <text> (sem foreignObject) para a exportacao em PNG funcionar.
    htmlLabels: false,
    flowchart: { htmlLabels: false, curve: 'basis', padding: 12 },
  })
  const id = `mmd-${++seq}`
  try {
    await mermaid.parse(code)
    const { svg } = await mermaid.render(id, code)
    return svg
  } finally {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
  }
}

function cleanError(error) {
  const text = String(error?.message || error || 'Erro desconhecido')
  return text.replace(/^Error:\s*/, '').trim()
}

export function useMermaid(code, delay = 0) {
  const { theme } = useTheme()
  const [state, setState] = useState({ svg: '', error: null, loading: true })

  useEffect(() => {
    const source = (code || '').trim()
    if (!source) {
      setState({ svg: '', error: null, loading: false })
      return undefined
    }
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    const timer = setTimeout(() => {
      renderSvg(source, theme)
        .then((svg) => alive && setState({ svg, error: null, loading: false }))
        .catch((e) => alive && setState((s) => ({ svg: s.svg, error: cleanError(e), loading: false })))
    }, delay)
    return () => { alive = false; clearTimeout(timer) }
  }, [code, theme, delay])

  return state
}

/** SVG avulso com largura/altura reais, pronto para baixar. */
function standalone(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = doc.documentElement
  const [, , w, h] = (el.getAttribute('viewBox') || '0 0 800 600').split(/[\s,]+/).map(Number)
  el.setAttribute('width', String(Math.ceil(w)))
  el.setAttribute('height', String(Math.ceil(h)))
  el.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  el.style.removeProperty('max-width')
  return { text: new XMLSerializer().serializeToString(el), w: Math.ceil(w), h: Math.ceil(h) }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const slug = (s) => (s || 'fluxograma').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'fluxograma'

async function exportPng(svg, name) {
  const { text, w, h } = standalone(svg)
  const scale = 2
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = cssVar('--surface')
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (blob) download(blob, `${slug(name)}.png`)
}

function MermaidError({ error }) {
  return (
    <div className="mm-error" role="alert">
      <strong><Icon name="warning" />Não deu para desenhar o fluxograma</strong>
      <pre>{error}</pre>
      <span>Confira a sintaxe Mermaid: a primeira linha declara o tipo (ex.: <code>flowchart TD</code>).</span>
    </div>
  )
}

/** Desenho ajustado a largura; com toolbar mostra zoom, tela cheia e exportacao. */
export default function MermaidDiagram({ code, name, toolbar = true, delay = 0 }) {
  const { svg, error, loading } = useMermaid(code, delay)
  const [zoom, setZoom] = useState(null) // null = ajustar
  const [full, setFull] = useState(false)
  const [fit, setFit] = useState(1)
  const canvas = useRef(null)
  const host = useRef(null)
  const size = useRef({ w: 0, h: 0 })

  const measure = useCallback(() => {
    const el = host.current?.querySelector('svg')
    const box = canvas.current
    if (!el || !box) return
    const vb = el.viewBox?.baseVal
    const w = vb?.width || 800
    const h = vb?.height || 600
    size.current = { w, h }
    const pad = 32
    const byWidth = (box.clientWidth - pad) / w
    const byHeight = (box.clientHeight - pad) / h
    setFit(Math.max(0.05, full ? Math.min(byWidth, byHeight) : Math.min(byWidth, 1)))
  }, [full])

  useLayoutEffect(() => {
    measure()
  }, [svg, measure])

  useEffect(() => {
    if (!canvas.current) return undefined
    const ro = new ResizeObserver(() => measure())
    ro.observe(canvas.current)
    return () => ro.disconnect()
  }, [measure])

  const scale = zoom ?? fit
  useLayoutEffect(() => {
    const el = host.current?.querySelector('svg')
    if (!el) return
    const { w, h } = size.current
    el.removeAttribute('height')
    el.style.maxWidth = 'none'
    el.style.width = `${w * scale}px`
    el.style.height = `${h * scale}px`
  }, [svg, scale])

  useEffect(() => {
    if (!full) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  useEffect(() => { setZoom(null) }, [full])

  const step = (dir) => setZoom(Math.min(4, Math.max(0.1, Math.round((scale * (dir > 0 ? 1.25 : 0.8)) * 100) / 100)))

  return (
    <div className={`mm ${full ? 'mm-full' : ''}`}>
      {toolbar && svg && (
        <div className="mm-toolbar">
          {full && <strong className="mm-name truncate">{name}</strong>}
          <div className="mm-tools">
            <button type="button" className="mm-btn" title="Diminuir" onClick={() => step(-1)}><Icon name="zoomOut" /></button>
            <button type="button" className="mm-btn mm-pct" title="Ajustar à tela" onClick={() => setZoom(null)}>
              {zoom === null ? 'Ajustar' : `${Math.round(scale * 100)}%`}
            </button>
            <button type="button" className="mm-btn" title="Aumentar" onClick={() => step(1)}><Icon name="zoomIn" /></button>
            <span className="mm-sep" />
            <button type="button" className="mm-btn" title="Baixar SVG"
              onClick={() => download(new Blob([standalone(svg).text], { type: 'image/svg+xml' }), `${slug(name)}.svg`)}>
              SVG
            </button>
            <button type="button" className="mm-btn" title="Baixar PNG" onClick={() => exportPng(svg, name)}>PNG</button>
            <span className="mm-sep" />
            <button type="button" className="mm-btn" title={full ? 'Fechar tela cheia (Esc)' : 'Abrir em tela cheia'}
              onClick={() => setFull(!full)}>
              <Icon name={full ? 'close' : 'fullscreen'} />
            </button>
          </div>
        </div>
      )}
      {error && <MermaidError error={error} />}
      <div className={`mm-canvas ${zoom === null ? 'fit' : ''} ${error && svg ? 'stale' : ''}`} ref={canvas}>
        {loading && !svg && <div className="loading"><span className="spinner" />Desenhando fluxograma…</div>}
        {/* SVG gerado pelo mermaid com securityLevel strict (sanitizado pelo DOMPurify interno). */}
        <div className="mm-svg" ref={host} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  )
}
