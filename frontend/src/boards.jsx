import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api.js'

const BoardsContext = createContext(null)
const KEY = 'produzia.quadros'

function readSelected() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || []
  } catch {
    return []
  }
}

export function BoardsProvider({ children }) {
  const [boards, setBoards] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelectedState] = useState(readSelected)
  const [version, setVersion] = useState(0)

  const reload = useCallback(async () => {
    const data = await api('/boards')
    setBoards(data.quadros)
    setLoaded(true)
  }, [])

  useEffect(() => { reload().catch(() => setLoaded(true)) }, [reload])

  const setSelected = (ids) => {
    setSelectedState(ids)
    try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* sem storage */ }
  }

  // Ignora ids de quadros que foram removidos.
  const valid = selected.filter((id) => boards.some((b) => b.id === id))
  const refresh = () => setVersion((v) => v + 1)

  return (
    <BoardsContext.Provider value={{ boards, loaded, selected: valid, setSelected, reload, version, refresh }}>
      {children}
    </BoardsContext.Provider>
  )
}

export const useBoards = () => useContext(BoardsContext)
