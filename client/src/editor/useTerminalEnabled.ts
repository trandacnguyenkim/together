import { useState } from 'react'

const ENABLED_KEY = 'together:terminal-enabled'

const readStoredEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

/** Same pattern as useAIEnabled: lives outside OutputPanel so the header
 *  toggle controls whether the panel mounts at all, not whether it hides
 *  its own contents. */
export function useTerminalEnabled(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(readStoredEnabled)

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    try {
      localStorage.setItem(ENABLED_KEY, String(next))
    } catch {
      // ignore — worst case the toggle doesn't persist across reloads
    }
  }

  return [enabled, toggle]
}
