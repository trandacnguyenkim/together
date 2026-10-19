import { useEffect, useRef } from 'react'
import '../userWorker.js' // must run before any monaco-editor import below
import * as monaco from 'monaco-editor'

export type EditorTheme = 'light' | 'dark'

const monacoThemeName = (theme: EditorTheme) => (theme === 'dark' ? 'together-dark' : 'together-light')

function defineThemes() {
  monaco.editor.defineTheme('together-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '808080', fontStyle: 'italic' },
      { token: 'string', foreground: '008000' },
      { token: 'string.escape', foreground: '0037a6' },
      { token: 'number', foreground: '0000ff' },
      { token: 'keyword', foreground: '000080', fontStyle: 'bold' },
      { token: 'delimiter', foreground: '000000' },
      { token: 'identifier', foreground: '000000' },
      { token: 'annotation', foreground: '808000' },
      { token: 'tag', foreground: '000080' },
      { token: 'attribute.name', foreground: 'ff0000' },
      { token: 'attribute.value', foreground: '008000' },
      { token: 'regexp', foreground: '008000' },
    ],
    colors: {
      'editor.background': '#fbf8ef',
      'editor.foreground': '#16213e',
      'editorLineNumber.foreground': '#5b6477',
      'editorLineNumber.activeForeground': '#16213e',
      'editorCursor.foreground': '#c6861a',
      'editor.selectionBackground': '#c6861a33',
      'editor.inactiveSelectionBackground': '#c6861a1a',
    },
  })
  // One Dark Pro's published token palette (binaryify/OneDark-Pro) —
  monaco.editor.defineTheme('together-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
      { token: 'string', foreground: '98c379' },
      { token: 'string.escape', foreground: '56b6c2' },
      { token: 'number', foreground: 'd19a66' },
      { token: 'keyword', foreground: 'c678dd' },
      { token: 'delimiter', foreground: 'abb2bf' },
      { token: 'identifier', foreground: 'abb2bf' },
      { token: 'annotation', foreground: 'e5c07b' },
      { token: 'tag', foreground: 'e06c75' },
      { token: 'attribute.name', foreground: 'd19a66' },
      { token: 'attribute.value', foreground: '98c379' },
      { token: 'regexp', foreground: '56b6c2' },
    ],
    colors: {
      'editor.background': '#0f1626',
      'editor.foreground': '#f2ead2',
      'editorLineNumber.foreground': '#aab3c7',
      'editorLineNumber.activeForeground': '#f2ead2',
      'editorCursor.foreground': '#f2c14e',
      'editor.selectionBackground': '#f2c14e33',
      'editor.inactiveSelectionBackground': '#f2c14e1a',
    },
  })
}

export interface EditorProps {
  theme: EditorTheme
  /** Called once with the created editor + its model, so a parent (the Yjs
   *  binding hook, added in step 2) can attach to it. Raw monaco-editor is
   *  used directly rather than @monaco-editor/react — the wrapper loads
   *  Monaco from a CDN by default, producing a second module instance whose
   *  ITextModel doesn't match the one MonacoBinding needs. */
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void
}

export function Editor({ theme, onMount }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // `onMount` is typically a fresh closure every render; reading it via a
  // ref keeps the effect below mount-once (correct — Monaco should not be
  // torn down and recreated on every parent render) without lying about
  // the effect's real dependencies.
  const onMountRef = useRef(onMount)
  onMountRef.current = onMount
  // Read only once, at creation — theme *changes* are handled by the
  // separate effect below via monaco.editor.setTheme, not by recreating
  // the editor.
  const initialThemeRef = useRef(theme)

  useEffect(() => {
    if (!containerRef.current) return

    defineThemes()

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
      fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
      theme: monacoThemeName(initialThemeRef.current),
    })

    onMountRef.current?.(editor)

    return () => {
      editor.dispose()
    }
  }, [])

  // monaco.editor.setTheme is global, not per-instance — fine here since
  // this app only ever mounts one editor.
  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName(theme))
  }, [theme])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
