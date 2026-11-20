import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { LayoutProvider } from './layout.jsx'
import { ThemeProvider } from './theme.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <LayoutProvider>
          <App />
        </LayoutProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
