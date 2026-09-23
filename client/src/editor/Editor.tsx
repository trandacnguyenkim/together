import { useEffect, useRef } from 'react'
import '../userWorker.js' // must run before any monaco-editor import below
import * as monaco from 'monaco-editor'

export interface EditorProps {
  /** Called once with the created editor + its model, so a parent (the Yjs
   *  binding hook, added in step 2) can attach to it. Raw monaco-editor is
   *  used directly rather than @monaco-editor/react — the wrapper loads
   *  Monaco from a CDN by default, producing a second module instance whose
   *  ITextModel doesn't match the one MonacoBinding needs. */
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void
}

export function Editor({ onMount }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // `onMount` is typically a fresh closure every render; reading it via a
  // ref keeps the effect below mount-once (correct — Monaco should not be
  // torn down and recreated on every parent render) without lying about
  // the effect's real dependencies.
  const onMountRef = useRef(onMount)
  onMountRef.current = onMount

  useEffect(() => {
    if (!containerRef.current) return

    // No initial `value` here — MonacoBinding (attached by useYjs, once the
    // editor is mounted) owns the model's content. Seeding text on the
    // model before binding is tempting but wrong: if two tabs open the same
    // empty room at once, each would independently insert its own seed
    // text into the Yjs doc before either sees the other's, producing
    // duplicated content. useYjs seeds a starter comment instead, once,
    // after sync confirms the room is actually empty.
    const editor = monaco.editor.create(containerRef.current, {
      language: 'typescript',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
    })

    onMountRef.current?.(editor)

    return () => {
      editor.dispose()
    }
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
