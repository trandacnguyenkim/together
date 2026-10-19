import { useEffect, useState } from 'react'

const THEME_KEY = 'together:theme'

export type Theme = 'light' | 'dark'

const readStoredTheme = (): Theme | null => {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

/** Explicit choice persisted in localStorage, falling back to the OS
 *  preference on first visit. Writes `data-theme` on <html> so tokens.css's
 *  [data-theme] rules take over from its prefers-color-scheme defaults. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => readStoredTheme() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // ignore — worst case the toggle doesn't persist across reloads
    }
  }

  return [theme, toggle]
}
