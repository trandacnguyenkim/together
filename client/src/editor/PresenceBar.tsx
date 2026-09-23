import { useEffect, useState } from 'react'
import type { WebsocketProvider } from 'y-websocket'
import type { LocalUser } from './presence.js'

interface PresentUser {
  clientId: number
  name: string
  color: string
  isLocal: boolean
}

export interface PresenceBarProps {
  provider: WebsocketProvider | null
  localUser: LocalUser
  connected: boolean
}

export function PresenceBar({ provider, localUser, connected }: PresenceBarProps) {
  const [users, setUsers] = useState<PresentUser[]>([])

  useEffect(() => {
    if (!provider) {
      setUsers([])
      return
    }
    const awareness = provider.awareness

    const render = () => {
      const next: PresentUser[] = []
      awareness.getStates().forEach((state, clientId) => {
        const user = (state as { user?: LocalUser } | undefined)?.user
        if (!user) return
        next.push({
          clientId,
          name: user.name,
          color: user.color,
          isLocal: clientId === awareness.clientID,
        })
      })
      // Stable order: local user first, then by clientId.
      next.sort((a, b) => (a.isLocal === b.isLocal ? a.clientId - b.clientId : a.isLocal ? -1 : 1))
      setUsers(next)
    }

    render()
    awareness.on('change', render)
    return () => awareness.off('change', render)
  }, [provider])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px' }}>
      <span
        title={connected ? 'connected' : 'connecting…'}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: connected ? '#2a7' : '#ccc',
          flexShrink: 0,
        }}
      />
      {users.length === 0 && (
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: localUser.color,
            color: '#fff',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={`${localUser.name} (you)`}
        >
          {localUser.name.slice(0, 1)}
        </span>
      )}
      {users.map((u) => (
        <span
          key={u.clientId}
          title={u.isLocal ? `${u.name} (you)` : u.name}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: u.color,
            color: '#fff',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: u.isLocal ? '2px solid #333' : 'none',
          }}
        >
          {u.name.slice(0, 1)}
        </span>
      ))}
    </div>
  )
}
