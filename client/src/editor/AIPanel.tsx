import { useState } from 'react'
import type * as monaco from 'monaco-editor'
import * as Y from 'yjs'

const ENABLED_KEY = 'together:ai-enabled'

interface AIPanelProps {
    ydoc: Y.Doc | null 
    editor: monaco.editor.IStandaloneCodeEditor | null 
}

const readStoredEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export function AIPanel({ydoc, editor} : AIPanelProps) {
  const [enabled, setEnabled] = useState(readStoredEnabled)

  const toggleEnabled = () => {
    const next = !enabled
    setEnabled(next)
    try {
      localStorage.setItem(ENABLED_KEY, String(next))
    } catch {
      // ignore — worst case the toggle doesn't persist across reloads
    }
  }

  // TODO (you): prompt + pending suggestion state go here. See the plan below.
  const [prompt, setPrompt] = useState('')

  type Suggestion = {
    id: string
    explanation: string 
    diffPreview: string
    anchorStart: Y.RelativePosition
    anchorEnd: Y.RelativePosition
  }

  const [pending, setPending] = useState<Suggestion | null>(null)

  const handleAsk = () => {
    if (!editor || !ydoc || !enabled || !prompt.trim()) return

    const selection = editor.getSelection()
    const model = editor.getModel()
    if (!selection || !model) return

    const ytext = ydoc.getText('monaco')
    const startOffset = model.getOffsetAt(selection.getStartPosition())
    const endOffset = model.getOffsetAt(selection.getEndPosition())
    const anchorStart = Y.createRelativePositionFromTypeIndex(ytext, startOffset)
    const anchorEnd = Y.createRelativePositionFromTypeIndex(ytext, endOffset)

    setTimeout(() => setPending({
      id: crypto.randomUUID(),
      explanation: 'place holder explanation',
      diffPreview: '+++ diff',
      anchorStart,
      anchorEnd,
    }), 600)
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
      console.warn('suggestion is stale — the anchored text no longer exists, discarding')
      setPending(null)
      return
    }

    ydoc.transact(() => {
      if (end.index > start.index) {
        ytext.delete(start.index, end.index - start.index)
      }
      ytext.insert(start.index, pending.diffPreview)
    })

    setPending(null)
  }

  const handleReject = () => {
    console.log('reject', pending?.id)
    setPending(null)
  }

  return (
    <div style={{ width: 320, borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column', padding: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={enabled} onChange={toggleEnabled} />
        AI pair programmer
      </label>
      
      <input type='text' value={prompt} disabled={!enabled} onChange={(e) => setPrompt(e.target.value)}/>
      <button onClick={handleAsk} disabled={!enabled}>Ask</button>

      {pending && (
        <div>
            <p>{pending.explanation}</p>
            <pre>{pending.diffPreview}</pre>
            <button onClick={handleAccept}>Accept</button>
            <button onClick={handleReject}>Reject</button>
        </div>
      )}
    </div>
  )
}
