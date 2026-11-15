import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui.jsx'

const ToastContext = createContext(null)
let seq = 0

// Avisos rápidos no canto da tela, com ação opcional ("Desfazer").
// toast({ text, tone: 'good' | 'bad' | 'info', action: { label, onClick }, duration })
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((opts) => {
    seq += 1
    const id = seq
    const t = { id, tone: 'info', duration: opts.action ? 8000 : 4500, ...opts }
    setItems((list) => [...list.slice(-3), t])
    timers.current.set(id, setTimeout(() => dismiss(id), t.duration))
    return id
  }, [dismiss])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'bad' ? 'warning' : t.tone === 'good' ? 'check' : 'item'} />
            <span className="toast-text">{t.text}</span>
            {t.action && (
              <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.action.onClick() }}>
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
