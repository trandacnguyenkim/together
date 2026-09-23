import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { MonacoBinding } from 'y-monaco'
import type * as monaco from 'monaco-editor'
import { installRemoteCursorStyles } from './cursors.js'
import type { LocalUser } from './presence.js'

// The server's WS upgrade handler is mounted at /yjs/<room> directly (see
// server/src/index.ts), and WebsocketProvider joins `${base url}/${room}`,
// so the base passed in must end in exactly `/yjs` with no trailing slash.
const wsBaseUrl = () => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/yjs`
}

export interface YjsHandle {
  ydoc: Y.Doc
  provider: WebsocketProvider
  connected: boolean
}

/**
 * Binds a Monaco editor to a Yjs room over WebSocket. The Y.Doc, provider,
 * and binding are all created *inside* this effect and torn down on
 * cleanup — not hoisted to module scope keyed by room. Hoisting looks
 * tempting as a fix for React StrictMode's dev-only double-mount, but it's
 * the wrong fix: the first mount's cleanup would destroy the doc the
 * second (real) mount is still using. Because Yjs updates are idempotent
 * CRDT ops, the double-mount doesn't corrupt document text either way —
 * the actual symptom is a leaked socket and a permanent ghost cursor in
 * awareness, which `provider.destroy()` (not `disconnect()`) resolves.
 */
export function useYjs(
  room: string,
  editor: monaco.editor.IStandaloneCodeEditor | null,
  localUser: LocalUser,
): YjsHandle | null {
  const [handle, setHandle] = useState<YjsHandle | null>(null)
  // Read via ref inside the effect so a change to localUser's object
  // identity (it shouldn't change, but just in case) doesn't retrigger a
  // full teardown/reconnect of the socket.
  const localUserRef = useRef(localUser)
  localUserRef.current = localUser

  useEffect(() => {
    if (!editor) return
    const model = editor.getModel()
    if (!model) return

    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(wsBaseUrl(), room, ydoc)
    const ytext = ydoc.getText('monaco')
    const binding = new MonacoBinding(ytext, model, new Set([editor]), provider.awareness)
    provider.awareness.setLocalStateField('user', localUserRef.current)
    const uninstallCursorStyles = installRemoteCursorStyles(provider.awareness)

    const onStatus = ({ status }: { status: string }) => {
      setHandle((prev) => (prev ? { ...prev, connected: status === 'connected' } : prev))
    }
    provider.on('status', onStatus)

    // Seed a starter comment exactly once, only after the initial sync
    // confirms the room is actually empty — not before. A race between two
    // tabs opening the same brand-new room at the same instant can still
    // both pass this check before either's insert propagates (Yjs has no
    // seed-once lock), so in the rare case both seed, the result is a
    // harmless duplicated comment, never corrupted or lost text.
    const onSynced = () => {
      if (ytext.length === 0) {
        ytext.insert(0, '// Together — start typing, or ask the AI panel to write something.\n')
      }
    }
    provider.once('sync', onSynced)

    setHandle({ ydoc, provider, connected: false })

    return () => {
      provider.off('status', onStatus)
      uninstallCursorStyles()
      binding.destroy()
      provider.destroy() // not disconnect() — this is what clears our awareness state
      ydoc.destroy()
      setHandle(null)
    }
  }, [room, editor])

  return handle
}
