import { createContext, useCallback, useContext, useEffect, useState } from 'react'

// Preferencias de layout lembradas no navegador (menu recolhido, lista recolhida...).
export function useStoredFlag(key, initial = false) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const set = useCallback((next) => {
    setValue((cur) => {
      const v = typeof next === 'function' ? next(cur) : next
      try { localStorage.setItem(key, v ? '1' : '0') } catch { /* sem storage */ }
      return v
    })
  }, [key])
  return [value, set]
}

const LayoutContext = createContext({
  navCollapsed: false, setNavCollapsed: () => {}, focus: false, setFocus: () => {},
})

export function LayoutProvider({ children }) {
  const [navCollapsed, setNavCollapsed] = useStoredFlag('produzia.menuRecolhido')
  // Modo foco: a pagina ocupa a janela inteira (sem menu nem barra do topo).
  const [focus, setFocus] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      // Ctrl/Cmd + B recolhe ou abre o menu lateral.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
        e.preventDefault()
        setNavCollapsed((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setNavCollapsed])

  return (
    <LayoutContext.Provider value={{ navCollapsed, setNavCollapsed, focus, setFocus }}>
      {children}
    </LayoutContext.Provider>
  )
}

export const useLayout = () => useContext(LayoutContext)
