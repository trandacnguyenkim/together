import { useRef } from 'react'

export interface LocalUser {
  name: string
  color: string
}

const COLORS = ['#e07a5f', '#3d5a80', '#81b29a', '#f2cc8f', '#9c6644', '#6d597a']

/** Random per-tab display name + color, stable for the tab's lifetime.
 *  Seeds awareness local state — see useYjs and cursors.ts. */
export function useLocalUser(): LocalUser {
  const ref = useRef<LocalUser | null>(null)
  if (!ref.current) {
    const id = Math.floor(Math.random() * 1000)
    ref.current = {
      name: `Guest ${id}`,
      color: COLORS[id % COLORS.length],
    }
  }
  return ref.current
}
