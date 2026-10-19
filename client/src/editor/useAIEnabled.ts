import { useState } from 'react'

const ENABLED_KEY = 'together:ai-enabled'

const readStoredEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

/** Per-tab, localStorage-persisted toggle for whether the AI panel is
 *  mounted at all — lives outside AIPanel itself so the header checkbox
 *  can control whether AIPanel renders, rather than AIPanel hiding its
 *  own contents while staying mounted. */
export function useAIEnabled(): [boolean, () => void] {
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
