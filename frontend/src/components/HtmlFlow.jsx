import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../theme.jsx'
import { Icon } from './ui.jsx'

// Fluxograma em HTML livre. Roda num iframe com sandbox sem allow-same-origin: o conteudo
// tem origem propria, sem acesso a sessao, cookies ou API do Produzia.
const BASE_CSS = `
:root { color-scheme: light; --pz-ink:#0f172a; --pz-muted:#64748b; --pz-line:#e2e8f0; --pz-surface:#ffffff;
  --pz-soft:#f1f5f9; --pz-brand:#0f766e; --pz-good:#0d9488; --pz-bad:#dc2626; --pz-amber:#d97706; --pz-indigo:#6366f1; }
:root[data-theme="dark"] { color-scheme: dark; --pz-ink:#e6edf0; --pz-muted:#8b9aa3; --pz-line:#24323a; --pz-surface:#121a1f;
  --pz-soft:#1c2830; --pz-brand:#14b8a6; --pz-good:#2dd4bf; --pz-bad:#f87171; --pz-amber:#fbbf24; --pz-indigo:#818cf8; }
html, body { margin: 0; background: transparent; }
body { font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--pz-ink); font-size: 14px;
  line-height: 1.45; -webkit-font-smoothing: antialiased; padding: 4px; box-sizing: border-box; }
`

// Mede a altura e avisa o Produzia; tambem aplica o tema quando ele muda.
const BRIDGE = `
(function () {
  var last = 0;
  function send() {
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (h !== last) { last = h; parent.postMessage({ produziaFluxo: true, altura: h }, '*'); }
  }
  addEventListener('load', send);
  addEventListener('resize', send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
  addEventListener('message', function (e) {
    if (e.data && e.data.produziaTema) document.documentElement.setAttribute('data-theme', e.data.produziaTema);
  });
  setTimeout(send, 50); setTimeout(send, 600);
})();
`

const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com">'
  + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">'

export function buildHtmlDoc(code, theme) {
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${FONT}<style>${BASE_CSS}</style>`
  const bridge = `<script>${BRIDGE}</script>`
  const isDocument = /<html[\s>]/i.test(code)
  if (!isDocument) {
    return `<!doctype html><html data-theme="${theme}"><head>${head}</head><body>${code}${bridge}</body></html>`
  }
  // Documento completo: injeta o tema, os estilos base (antes dos do autor) e a ponte.
  let doc = code.replace(/<html([^>]*)>/i, (m, attrs) => (
    /data-theme=/i.test(attrs) ? m : `<html${attrs} data-theme="${theme}">`))
  doc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head([^>]*)>/i, `<head$1>${head}`) : doc.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`)
  doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${bridge}</body>`) : `${doc}${bridge}`
  return doc
}

export default function HtmlFlow({ code, name = 'fluxograma', toolbar = true, delay = 0, minHeight = 160 }) {
  const { theme } = useTheme()
  const frame = useRef(null)
  const wrap = useRef(null)
  const [height, setHeight] = useState(minHeight)
  const [source, setSource] = useState(code)

  // No editor, espera a digitacao parar antes de redesenhar.
  useEffect(() => {
    if (!delay) { setSource(code); return undefined }
    const t = setTimeout(() => setSource(code), delay)
    return () => clearTimeout(t)
  }, [code, delay])

  // O tema inicial vai no documento; mudancas depois vao por mensagem (sem recarregar o iframe).
  const themeAtBuild = useRef(theme)
  const srcDoc = useMemo(() => {
    themeAtBuild.current = theme
    return buildHtmlDoc(source, theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ produziaTema: theme }, '*')
  }, [theme])

  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.produziaFluxo) return
      setHeight(Math.max(minHeight, Math.min(Number(e.data.altura) || 0, 20000)))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [minHeight])

  function download() {
    const blob = new Blob([buildHtmlDoc(code, theme)], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'fluxograma'}.html`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else wrap.current?.requestFullscreen?.()
  }

  return (
    <div className="hf" ref={wrap}>
      {toolbar && (
        <div className="hf-toolbar">
          <span className="hf-badge">HTML</span>
          <button className="btn btn-ghost btn-icon" type="button" title="Tela cheia" onClick={fullscreen}><Icon name="fullscreen" /></button>
          <button className="btn btn-ghost btn-icon" type="button" title="Baixar .html" onClick={download}><Icon name="download" /></button>
        </div>
      )}
      <iframe
        ref={frame}
        className="hf-frame"
        title={`Fluxograma: ${name}`}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={{ height }}
        onLoad={() => frame.current?.contentWindow?.postMessage({ produziaTema: theme }, '*')}
      />
    </div>
  )
}
