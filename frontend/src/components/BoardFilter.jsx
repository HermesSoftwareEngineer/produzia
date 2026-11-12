import { useEffect, useRef, useState } from 'react'
import { useBoards } from '../boards.jsx'
import { Icon } from './ui.jsx'

export default function BoardFilter() {
  const { boards, selected, setSelected } = useBoards()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (!boards.length) return null
  let label = `Todos os quadros (${boards.length})`
  if (selected.length === 1) label = boards.find((b) => b.id === selected[0])?.nome
  else if (selected.length > 1) label = `${selected.length} quadros`

  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id])

  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-ghost dropdown-toggle" type="button" onClick={() => setOpen(!open)}>
        <Icon name="board" /><span className="truncate">{label}</span><Icon name="chevron" />
      </button>
      {open && (
        <div className="dropdown-menu">
          <label className="check-row">
            <input type="checkbox" checked={!selected.length} onChange={() => setSelected([])} />
            <span>Todos os quadros</span>
          </label>
          <hr />
          {boards.map((b) => (
            <label className="check-row" key={b.id}>
              <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} />
              <span>{b.nome}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
