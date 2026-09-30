import { useState } from 'react'

const ENABLED_KEY = 'together:ai-enabled'

const readStoredEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export function AIPanel() {
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
  }

  const [pending, setPending] = useState<Suggestion | null>(null)

  const handleAsk = () => {
    if (enabled && prompt.trim()){
        setTimeout(() => setPending({
            id: crypto.randomUUID(),
            explanation: 'place holder explanation',
            diffPreview: '+++ diff'
        }), 600)
    }
  }

  const handleAccept = () => {
    console.log('accept', pending?.id)
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
