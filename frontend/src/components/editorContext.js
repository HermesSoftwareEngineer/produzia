import { createContext, useContext } from 'react'

// Contexto do editor de card (CardDrawer). Fica num módulo próprio para o ui.jsx usar sem ciclo de import.
export const EditorContext = createContext({ openCard: null })
export const useCardEditor = () => useContext(EditorContext)
