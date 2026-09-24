/**
 * Shared harness for ws.ts's test suites. Spins up the same upgrade-routing
 * this project's real server does (see ../index.ts) on an ephemeral port,
 * and drives it with the real `y-websocket` client (`WebsocketProvider`,
 * polyfilled onto Node's `ws`) rather than hand-rolled protocol messages —
 * so these tests exercise the exact wire format a browser tab would use.
 *
 * Not a `*.test.ts` file itself, so vitest won't try to run it as a suite.
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import WS from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { setupWSConnection, type Persistence } from './ws.js'

// Each WebsocketProvider registers a `process.on('exit', ...)` cleanup hook
// (removed again on `.destroy()`) — stress tests intentionally hold many at
// once, which trips Node's default max-listener warning. Purely cosmetic.
process.setMaxListeners(500)

export interface TestServer {
  url: string
  close: () => Promise<void>
}

export const startTestServer = async (): Promise<TestServer> => {
  const server = http.createServer()
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://internal')
    if (!pathname.startsWith('/yjs/')) {
      socket.destroy()
      return
    }
    const docName = pathname.slice('/yjs/'.length)
    if (!docName) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => setupWSConnection(ws, req, { docName }))
  })

  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    url: `ws://localhost:${port}/yjs`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // A test whose assertion throws mid-body skips its own cleanup, leaving
        // that client's socket open — which would otherwise make server.close()
        // hang forever waiting for connections to drain. Force them closed so
        // suite teardown never depends on every test having cleaned up perfectly.
        wss.clients.forEach((ws) => ws.terminate())
        wss.close()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

export interface TestClient {
  ydoc: Y.Doc
  provider: WebsocketProvider
  ytext: Y.Text
}

/** Connects a fresh Y.Doc to `room` via the real WebsocketProvider. BroadcastChannel
 *  is disabled so two clients in the same test process can only converge through the
 *  actual server relay under test, not an in-process shortcut. */
export const connectClient = (baseUrl: string, room: string): TestClient => {
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(baseUrl, room, ydoc, {
    WebSocketPolyfill: WS as unknown as typeof WebSocket,
    disableBc: true,
  })
  return { ydoc, provider, ytext: ydoc.getText('monaco') }
}

export const waitForSync = (provider: WebsocketProvider): Promise<void> =>
  new Promise((resolve) => {
    if (provider.synced) {
      resolve()
      return
    }
    provider.once('sync', () => resolve())
  })

export const connectAndSync = async (baseUrl: string, room: string): Promise<TestClient> => {
  const client = connectClient(baseUrl, room)
  await waitForSync(client.provider)
  return client
}

export const disconnectAll = (clients: TestClient[]): void => {
  for (const c of clients) {
    c.provider.destroy()
    c.ydoc.destroy()
  }
}

export const uniqueRoom = (prefix = 'room'): string => `${prefix}-${randomUUID()}`

/** A `Persistence` that does no I/O — for tests that only need "a persistence
 *  layer is configured" (which is what gates doc-map cleanup in ws.ts) without
 *  touching disk. */
export const noopPersistence: Persistence = {
  bindState: async () => {},
  writeState: async () => {},
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Polls `getters` until every value agrees and stays agreeing for two
 * consecutive polls (guards against a false-positive lull mid-burst), or
 * throws with the divergent snapshots if `timeoutMs` elapses first.
 */
export const waitUntilConverged = async (
  getters: Array<() => string>,
  { timeoutMs = 5000, pollMs = 25 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string> => {
  const start = Date.now()
  let last: string[] | null = null
  let stableStreak = 0

  while (Date.now() - start < timeoutMs) {
    const snapshot = getters.map((g) => g())
    const allEqual = snapshot.every((s) => s === snapshot[0])
    const unchangedSinceLastPoll = last !== null && snapshot.every((s, i) => s === last![i])

    if (allEqual && unchangedSinceLastPoll) {
      stableStreak++
      if (stableStreak >= 2) return snapshot[0]
    } else {
      stableStreak = 0
    }
    last = snapshot
    await sleep(pollMs)
  }

  const preview = getters.map((g) => JSON.stringify(g().slice(0, 120)))
  throw new Error(`docs did not converge within ${timeoutMs}ms:\n${preview.join('\n')}`)
}

const randomWord = (): string => Math.random().toString(36).slice(2, 7)

/** Performs `ops` random inserts (and, once the text is long enough, occasional
 *  small deletes) on `ytext`, with a tiny random delay between each so operations
 *  from different clients interleave on the wire instead of landing in lockstep. */
export const performRandomEdits = async (
  ytext: Y.Text,
  ops: number,
  { allowDeletes = true }: { allowDeletes?: boolean } = {},
): Promise<number> => {
  let insertedChars = 0
  for (let i = 0; i < ops; i++) {
    const len = ytext.length
    const doDelete = allowDeletes && len > 10 && Math.random() < 0.25
    if (doDelete) {
      const start = Math.floor(Math.random() * len)
      const delLen = Math.min(len - start, 1 + Math.floor(Math.random() * 4))
      ytext.delete(start, delLen)
    } else {
      const word = randomWord()
      const pos = Math.floor(Math.random() * (ytext.length + 1))
      ytext.insert(pos, word)
      insertedChars += word.length
    }
    await sleep(Math.random() * 5)
  }
  return insertedChars
}
