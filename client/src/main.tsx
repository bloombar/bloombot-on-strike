import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Suppress noisy warnings from HeyGen LiveAvatar SDK
const suppressedWarnings = ['New unsupported event type', 'trackUnsubscribed']
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && suppressedWarnings.includes(args[0])) return
  originalWarn.apply(console, args)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
