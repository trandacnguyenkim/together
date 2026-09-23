import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

const container = document.getElementById('app-root')
if (!container) throw new Error('missing #app-root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
