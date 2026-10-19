import { useEffect, useState, useCallback } from 'react'
import type * as monaco from 'monaco-editor'
import { Editor } from './editor/Editor.js'
import { useYjs } from './editor/useYjs.js'
import { useLocalUser } from './editor/presence.js'
import { PresenceBar } from './editor/PresenceBar.js'
import { AIPanel } from './editor/AIPanel.js'
import { useAIEnabled } from './editor/useAIEnabled.js'

interface HealthResponse {
  ok: boolean
  docker: { daemonReachable: boolean; imagePresent: boolean; error?: string }
  groqKeyConfigured: boolean
  cloudflareConfigured: boolean
}

/** Room = URL path (minus leading slash), so two tabs on the same URL share
 *  a document and different paths get different rooms. Falls back to
 *  "default" for the bare "/" — visiting the root shouldn't 404 a room. */
function useRoom(): string {
  const [room] = useState(() => {
    const path = window.location.pathname.replace(/^\/+/, '')
    return path || 'default'
  })
  return room
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null)

  const room = useRoom()
  const localUser = useLocalUser()
  const yjs = useYjs(room, editor, localUser)
  const [aiEnabled, toggleAIEnabled] = useAIEnabled()

  const handleEditorMount = useCallback((e: monaco.editor.IStandaloneCodeEditor) => {
    setEditor(e)
  }, [])

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(String(err)))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 16px',
          borderBottom: '1px solid #ddd',
          fontSize: 13,
        }}
      >
        <div>
          <strong>Together</strong>
          <span style={{ marginLeft: 12, color: '#888' }}>room: {room}</span>
          {error && <span style={{ color: 'crimson', marginLeft: 12 }}>health check failed: {error}</span>}
          {health && (
            <span style={{ marginLeft: 12, color: health.ok ? '#2a7' : '#c33' }}>
              server ok · docker {health.docker.daemonReachable ? 'up' : 'down'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PresenceBar provider={yjs?.provider ?? null} localUser={localUser} connected={yjs?.connected ?? false} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
            <input type="checkbox" checked={aiEnabled} onChange={toggleAIEnabled} />
            AI pair programmer
          </label>
        </div>
        
        
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <Editor onMount={handleEditorMount} />
        </div>
        {aiEnabled && <AIPanel ydoc={yjs?.ydoc ?? null} editor={editor} />}
      </div>
    </div>
  )
}
