import { useEffect, useRef, useState } from 'react'
import type * as monaco from 'monaco-editor'
import * as Y from 'yjs'

interface AIPanelProps {
  ydoc: Y.Doc | null
  editor: monaco.editor.IStandaloneCodeEditor | null
}

/** Upward-arrow send icon, drawn in the same 8x8 pixel-grid style as the
 *  Sun/Moon icons in App.tsx, so it matches the app's pixel-art look. */
function SendIcon() {
  return (
    <svg viewBox="0 0 8 8" width={14} height={14} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      <rect x={3} y={0} width={2} height={1} />
      <rect x={2} y={1} width={4} height={1} />
      <rect x={1} y={2} width={6} height={1} />
      <rect x={3} y={3} width={2} height={5} />
    </svg>
  )
}

type Suggestion =
  | {
      type: 'edit'
      id: string
      explanation: string
      suggestedText: string
      anchorStart: Y.RelativePosition
      anchorEnd: Y.RelativePosition
    }
  | {
      type: 'text'
      id: string
      text: string
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)

  // Auto-grows the ask box with its content, capped to the answer panel's
  // own height (beyond that it scrolls internally instead of growing).
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const maxHeight = answerRef.current?.clientHeight ?? Infinity
    textarea.style.height = 'auto'
    const grownHeight = Math.max(textarea.scrollHeight, 32)
    textarea.style.height = `${Math.min(grownHeight, maxHeight)}px`
    textarea.style.overflowY = grownHeight > maxHeight ? 'auto' : 'hidden'
  }, [prompt])

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
    setPrompt('')

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

      if (data.type === 'edit') {
        setPending({
          type: 'edit',
          id: crypto.randomUUID(),
          explanation: data.explanation,
          suggestedText: data.suggestedText,
          anchorStart,
          anchorEnd,
        })
      } else {
        setPending({
          type: 'text',
          id: crypto.randomUUID(),
          text: data.text,
        })
      }
    } catch {
      if (requestId !== requestIdRef.current) return
      setError('Could not reach the server')
    } finally {
      if (requestId === requestIdRef.current) setIsAsking(false)
    }
  }

  const handleAccept = () => {
    if (!pending || pending.type !== 'edit' || !ydoc) {
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
      className="pixel-panel"
      style={{
        width: 320,
        flexShrink: 0,
        minHeight: 0,
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
        className="pixel-border"
        style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-surface)' }}
      >
        <textarea
          ref={textareaRef}
          value={prompt}
          disabled={isAsking}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleAsk()
            }
          }}
          placeholder="Ask the AI..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            height: 32,
            padding: '6px var(--space-2)',
            border: 'none',
            borderRadius: 0,
            outline: 'none',
            background: 'transparent',
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            overflowY: 'hidden',
            resize: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: 4,
          }}
        >
          <button
            type="submit"
            className="pixel-button pixel-button--icon pixel-button--primary"
            disabled={isAsking || !prompt.trim() || !editor || !ydoc}
            aria-label="Ask"
          >
            {isAsking ? '…' : <SendIcon />}
          </button>
        </div>
      </form>

      <div
        ref={answerRef}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {error && <p style={{ color: 'var(--color-status-error)', fontSize: 12, margin: 0 }}>{error}</p>}

        {pending && pending.type === 'edit' && (
          <div className="pixel-border" style={{ padding: 8, background: 'var(--color-surface)' }}>
            <p style={{ fontSize: 13, margin: '0 0 6px', color: 'var(--color-ink)' }}>{pending.explanation}</p>
            <pre className="pixel-code" style={{ margin: '0 0 6px' }}>
              {pending.suggestedText}
            </pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="pixel-button pixel-button--primary" onClick={handleAccept}>
                Accept
              </button>
              <button className="pixel-button" onClick={handleReject}>
                Reject
              </button>
            </div>
          </div>
        )}

        {pending && pending.type === 'text' && (
          <div className="pixel-border" style={{ padding: 8, background: 'var(--color-surface)' }}>
            <p style={{ fontSize: 13, margin: 0, color: 'var(--color-ink)', whiteSpace: 'pre-wrap' }}>
              {pending.text}
            </p>
            <button
              className="pixel-button"
              style={{ marginTop: 6 }}
              onClick={handleReject}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
