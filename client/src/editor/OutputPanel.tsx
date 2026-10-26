import { useRef, useState } from 'react'

interface OutputPanelProps {
  room: string
}

type LineStream = 'stdout' | 'stderr' | 'system'
interface Line {
  stream: LineStream
  text: string
}

interface SSEEvent {
  event: string
  data: unknown
}

/** One `event: x\ndata: y` block (the bit between `\n\n` separators) into
 *  its parts. Returns null for anything without a data line — a bare
 *  keep-alive comment, or a stray blank chunk at a read boundary. */
function parseSSEBlock(raw: string): SSEEvent | null {
  let event = 'message'
  let dataLine: string | null = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice('event: '.length)
    else if (line.startsWith('data: ')) dataLine = line.slice('data: '.length)
  }
  if (dataLine === null) return null
  try {
    return { event, data: JSON.parse(dataLine) }
  } catch {
    return null
  }
}

const streamColor: Record<LineStream, string> = {
  stdout: 'var(--color-ink)',
  stderr: 'var(--color-status-error)',
  system: 'var(--color-ink-muted)',
}

/** Only ever rendered while the Terminal toggle (owned by App, via
 *  useTerminalEnabled) is on — same mount/unmount pattern as AIPanel.
 *  Run always executes the *current synced* contents of the room's
 *  document, read server-side from the live Yjs doc, so every tab in the
 *  room is running the same thing a click would show them. */
export function OutputPanel({ room }: OutputPanelProps) {
  const [lines, setLines] = useState<Line[]>([])
  const [running, setRunning] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  // Closing the fetch is the only "cancel" primitive available here — the
  // server notices the connection drop (req 'close') and kills the
  // container from that, the same way Ctrl+C in a real terminal relies on
  // the OS delivering SIGINT to whatever's attached.
  const abortControllerRef = useRef<AbortController | null>(null)

  const appendLine = (line: Line) => {
    setLines((prev) => [...prev, line])
    // Stick to the bottom as output streams in.
    requestAnimationFrame(() => {
      const el = outputRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  const handleEvent = ({ event, data }: SSEEvent) => {
    if (event === 'stdout' && typeof data === 'object' && data && 'chunk' in data) {
      appendLine({ stream: 'stdout', text: String((data as { chunk: unknown }).chunk) })
    } else if (event === 'stderr' && typeof data === 'object' && data && 'chunk' in data) {
      appendLine({ stream: 'stderr', text: String((data as { chunk: unknown }).chunk) })
    } else if (event === 'done' && typeof data === 'object' && data) {
      const { exitCode, timedOut, aborted } = data as {
        exitCode: number | null
        timedOut: boolean
        aborted: boolean
      }
      appendLine({
        stream: 'system',
        text: aborted
          ? `stopped (exit ${exitCode ?? '?'})`
          : timedOut
            ? `killed after 10s timeout (exit ${exitCode ?? '?'})`
            : `exited with code ${exitCode ?? '?'}`,
      })
    } else if (event === 'error' && typeof data === 'object' && data && 'message' in data) {
      appendLine({ stream: 'system', text: `error: ${String((data as { message: unknown }).message)}` })
    }
  }

  const handleRun = async () => {
    if (running) return
    setLines([])
    setRunning(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null)
        const message = data?.error ?? `request failed (${res.status})`
        appendLine({ stream: 'system', text: data?.detail ? `${message}\n${data.detail}` : message })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const parsed = parseSSEBlock(block)
          if (parsed) handleEvent(parsed)
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch (err) {
      // Aborting locally rejects the in-flight read with this — it's the
      // Stop button working as intended, not a dropped connection. The
      // server's own 'done' event (aborted: true) never reaches us: once
      // abort() fires, the browser tears down the response stream
      // immediately rather than waiting for the server to finish sending.
      if (err instanceof DOMException && err.name === 'AbortError') {
        appendLine({ stream: 'system', text: 'stopped' })
      } else {
        appendLine({ stream: 'system', text: `connection lost: ${(err as Error).message}` })
      }
    } finally {
      abortControllerRef.current = null
      setRunning(false)
    }
  }

  const handleStop = () => {
    abortControllerRef.current?.abort()
  }

  return (
    <div
      className="pixel-panel"
      style={{
        height: 200,
        flexShrink: 0,
        margin: '0 8px 8px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Terminal
        </span>
        {running ? (
          <button type="button" className="pixel-button" onClick={handleStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="pixel-button pixel-button--primary" onClick={() => void handleRun()}>
            Run
          </button>
        )}
      </div>
      <div
        ref={outputRef}
        className="pixel-code"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          margin: '0 10px 10px',
          padding: 8,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {lines.length === 0 && !running && (
          <span style={{ color: 'var(--color-ink-muted)' }}>Click Run to execute this room's code in a sandboxed container.</span>
        )}
        {lines.map((line, i) => (
          <span key={i} style={{ color: streamColor[line.stream] }}>
            {line.text}
          </span>
        ))}
      </div>
    </div>
  )
}
