import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MermaidDiagram from './Mermaid.jsx'

const plugins = [remarkGfm]

function codeOf(node) {
  const code = node?.children?.[0]
  if (code?.tagName !== 'code') return null
  const classes = code.properties?.className || []
  const text = (code.children || []).map((c) => c.value || '').join('')
  return { lang: classes.find((c) => String(c).startsWith('language-'))?.slice(9), text }
}

const components = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  // Blocos ```mermaid dentro do documento viram diagrama, como no GitHub.
  pre: ({ node, ...props }) => {
    const code = codeOf(node)
    if (code?.lang === 'mermaid') return <div className="md-diagram"><MermaidDiagram code={code.text} toolbar={false} /></div>
    return <pre {...props} />
  },
  table: ({ node, ...props }) => <div className="md-table"><table {...props} /></div>,
}

/** Markdown GitHub-flavored. HTML bruto nao e renderizado (padrao seguro do react-markdown). */
export default function MarkdownView({ source }) {
  return (
    <div className="md">
      <Markdown remarkPlugins={plugins} components={components}>{source || ''}</Markdown>
    </div>
  )
}
