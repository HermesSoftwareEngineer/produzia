import { createContext, useContext, useEffect, useState } from 'react'
import { Icon } from './components/ui.jsx'

const KEY = 'produzia.tema'
const ThemeContext = createContext({ mode: 'sistema', theme: 'light', setMode: () => {} })
const media = window.matchMedia('(prefers-color-scheme: dark)')

function readMode() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'claro' || v === 'escuro' ? v : 'sistema'
  } catch {
    return 'sistema'
  }
}

const resolve = (mode, systemDark) => (mode === 'escuro' || (mode === 'sistema' && systemDark) ? 'dark' : 'light')

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readMode)
  const [systemDark, setSystemDark] = useState(media.matches)
  const theme = resolve(mode, systemDark)

  useEffect(() => {
    const onChange = (e) => setSystemDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const setMode = (m) => {
    setModeState(m)
    try { localStorage.setItem(KEY, m) } catch { /* sem storage */ }
  }

  return <ThemeContext.Provider value={{ mode, theme, setMode }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)

const OPTIONS = [
  { value: 'claro', icon: 'sun', label: 'Modo claro' },
  { value: 'sistema', icon: 'monitor', label: 'Seguir o sistema' },
  { value: 'escuro', icon: 'moon', label: 'Modo escuro' },
]

export function ThemeSwitch() {
  const { mode, setMode } = useTheme()
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Tema">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={mode === o.value} title={o.label}
          className={mode === o.value ? 'active' : ''} onClick={() => setMode(o.value)}>
          <Icon name={o.icon} />
        </button>
      ))}
    </div>
  )
}
