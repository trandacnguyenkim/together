import { useRef, useState } from 'react'
import type * as monaco from 'monaco-editor'
import * as Y from 'yjs'

interface AIPanelProps {
  ydoc: Y.Doc | null
  editor: monaco.editor.IStandaloneCodeEditor | null
}

type Suggestion = {
  id: string
  explanation: string
  suggestedText: string
  anchorStart: Y.RelativePosition
  anchorEnd: Y.RelativePosition
}

/** Only ever rendered while the AI toggle (owned by App, via useAIEnabled)
 *  is on — App mounts/unmounts this component entirely rather than this
 *  component hiding its own contents, so it can stay a plain, constant-size
 *  panel with no on/off logic of its own. */
export function AIPanel({ ydoc, editor }: AIPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [pending, setPending] = useState<Suggestion | null>(null)
  const [isAsking, setIsAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards against a slow, superseded request overwriting state set by a
  // later one — bumped on every Ask, compared when each response lands.
  const requestIdRef = useRef(0)

  const handleAsk = async () => {
    if (!editor || !ydoc || !prompt.trim() || isAsking) return

    const selection = editor.getSelection()
    const model = editor.getModel()
    if (!selection || !model) return

    const ytext = ydoc.getText('monaco')
    const startOffset = model.getOffsetAt(selection.getStartPosition())
    const endOffset = model.getOffsetAt(selection.getEndPosition())
    const anchorStart = Y.createRelativePositionFromTypeIndex(ytext, startOffset)
    const anchorEnd = Y.createRelativePositionFromTypeIndex(ytext, endOffset)

    const requestId = ++requestIdRef.current
    setIsAsking(true)
    setError(null)

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          fullText: model.getValue(),
          selectionStart: startOffset,
          selectionEnd: endOffset,
        }),
      })
      const data = await res.json()
      if (requestId !== requestIdRef.current) return // superseded by a newer Ask

      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'AI request failed')
        return
      }

      setPending({
        id: crypto.randomUUID(),
        explanation: data.explanation,
        suggestedText: data.suggestedText,
        anchorStart,
        anchorEnd,
      })
    } catch {
      if (requestId !== requestIdRef.current) return
      setError('Could not reach the server')
    } finally {
      if (requestId === requestIdRef.current) setIsAsking(false)
    }
  }

  const handleAccept = () => {
    if (!pending || !ydoc) {
      setPending(null)
      return
    }

    const ytext = ydoc.getText('monaco')
    const start = Y.createAbsolutePositionFromRelativePosition(pending.anchorStart, ydoc)
    const end = Y.createAbsolutePositionFromRelativePosition(pending.anchorEnd, ydoc)

    if (!start || !end) {
      setError('That suggestion no longer applies — the code it was based on has changed.')
      setPending(null)
      return
    }

    ydoc.transact(() => {
      if (end.index > start.index) {
        ytext.delete(start.index, end.index - start.index)
      }
      ytext.insert(start.index, pending.suggestedText)
    })

    setPending(null)
  }

  const handleReject = () => {
    setPending(null)
  }

  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid #ddd',
        display: 'flex',
        flexDirection: 'column',
        padding: 12,
        gap: 8,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleAsk()
        }}
        style={{ display: 'flex', gap: 4 }}
      >
        <input
          type="text"
          value={prompt}
          disabled={isAsking}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask the AI..."
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={isAsking || !prompt.trim() || !editor || !ydoc}>
          {isAsking ? '…' : 'Ask'}
        </button>
      </form>

      {error && <p style={{ color: '#c33', fontSize: 12, margin: 0 }}>{error}</p>}

      {pending && (
        <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: 8 }}>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>{pending.explanation}</p>
          <pre
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              background: '#f6f6f6',
              padding: 6,
              borderRadius: 3,
              margin: '0 0 6px',
            }}
          >
            {pending.suggestedText}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAccept}>Accept</button>
            <button onClick={handleReject}>Reject</button>
          </div>
        </div>
      )}
    </div>
  )
}
