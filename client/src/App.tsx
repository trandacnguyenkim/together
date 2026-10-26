import { useEffect, useState, useCallback } from 'react'
import type * as monaco from 'monaco-editor'
import { Editor } from './editor/Editor.js'
import { useYjs } from './editor/useYjs.js'
import { useLocalUser } from './editor/presence.js'
import { PresenceBar } from './editor/PresenceBar.js'
import { AIPanel } from './editor/AIPanel.js'
import { useAIEnabled } from './editor/useAIEnabled.js'
import { useTheme } from './editor/useTheme.js'
import { OutputPanel } from './editor/OutputPanel.js'
import { useTerminalEnabled } from './editor/useTerminalEnabled.js'

/** 8x8 pixel-grid icons, drawn as rects rather than a path so edges stay
 *  crisp at this size — matches the blocky/pixel look rather than a smooth
 *  icon-font glyph. */
function SunIcon() {
  return (
    <svg viewBox="0 0 8 8" width={14} height={14} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      <rect x={2} y={0} width={1} height={1} />
      <rect x={5} y={0} width={1} height={1} />
      <rect x={3} y={1} width={2} height={1} />
      <rect x={0} y={2} width={1} height={1} />
      <rect x={2} y={2} width={4} height={1} />
      <rect x={7} y={2} width={1} height={1} />
      <rect x={1} y={3} width={6} height={1} />
      <rect x={1} y={4} width={6} height={1} />
      <rect x={0} y={5} width={1} height={1} />
      <rect x={2} y={5} width={4} height={1} />
      <rect x={7} y={5} width={1} height={1} />
      <rect x={3} y={6} width={2} height={1} />
      <rect x={2} y={7} width={1} height={1} />
      <rect x={5} y={7} width={1} height={1} />
    </svg>
  )
}

/** Crescent: a filled circle with a smaller circle subtracted from its
 *  right side (worked out by hand, row by row, rather than approximated
 *  freehand — hence the asymmetric taper top/bottom and the flat-ish
 *  cut edge on the right). */
function MoonIcon() {
  return (
    <svg viewBox="0 0 8 8" width={14} height={14} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      <rect x={4} y={0} width={2} height={1} />
      <rect x={3} y={1} width={3} height={1} />
      <rect x={2} y={2} width={3} height={1} />
      <rect x={2} y={3} width={3} height={1} />
      <rect x={2} y={4} width={3} height={1} />
      <rect x={2} y={5} width={3} height={1} />
      <rect x={3} y={6} width={3} height={1} />
      <rect x={4} y={7} width={2} height={1} />
    </svg>
  )
}

/** A ">_" prompt glyph — the chevron and cursor read as "terminal" at a
 *  glance without needing an outer frame, same free-form filled-dot style
 *  as Sun/Moon rather than a bordered box icon. */
function TerminalIcon() {
  return (
    <svg viewBox="0 0 8 8" width={14} height={14} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      <rect x={0} y={1} width={2} height={1} />
      <rect x={1} y={2} width={2} height={1} />
      <rect x={2} y={3} width={2} height={1} />
      <rect x={1} y={4} width={2} height={1} />
      <rect x={0} y={5} width={2} height={1} />
      <rect x={5} y={5} width={3} height={1} />
    </svg>
  )
}

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
  const [terminalEnabled, toggleTerminalEnabled] = useTerminalEnabled()
  const [theme, toggleTheme] = useTheme()

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
        className="pixel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 48,
          padding: '0 16px',
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <strong
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 14,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: 'var(--color-accent)',
            }}
          >
            Together
          </strong>
          <span style={{ marginLeft: 12, color: 'var(--color-ink-muted)' }}>room: {room}</span>
          {error && (
            <span style={{ color: 'var(--color-status-error)', marginLeft: 12 }}>health check failed: {error}</span>
          )}
          {health && (
            <span style={{ marginLeft: 12, color: health.ok ? 'var(--color-status-ok)' : 'var(--color-status-error)' }}>
              server ok · docker {health.docker.daemonReachable ? 'up' : 'down'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="pixel-button pixel-button--icon"
            onClick={toggleTheme}
            data-tooltip={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
          </button>
          <button
            type="button"
            className={`pixel-button${aiEnabled ? ' pixel-button--toggled' : ''}`}
            onClick={toggleAIEnabled}
            aria-pressed={aiEnabled}
            data-tooltip={terminalEnabled ? 'Turn on AI' : 'Turn off AI'}
          >
            AI
          </button>
          <button
            type="button"
            className={`pixel-button pixel-button--icon${terminalEnabled ? ' pixel-button--toggled' : ''}`}
            onClick={toggleTerminalEnabled}
            aria-pressed={terminalEnabled}
            aria-label="Toggle terminal / sandbox runner"
            data-tooltip={terminalEnabled ? 'Hide Terminal' : 'Show Terminal'}
          >
            <TerminalIcon />
          </button>
          <PresenceBar provider={yjs?.provider ?? null} localUser={localUser} connected={yjs?.connected ?? false} />
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="pixel-border" style={{ flex: 1, minHeight: 0, margin: 8 }}>
            <Editor theme={theme} onMount={handleEditorMount} />
          </div>
          {terminalEnabled && <OutputPanel room={room} />}
        </div>
        {aiEnabled && <AIPanel ydoc={yjs?.ydoc ?? null} editor={editor} />}
      </div>
    </div>
  )
}
