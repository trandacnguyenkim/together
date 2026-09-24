/**
 * Systematic concurrency/correctness tests for the collaboration server in
 * ./ws.ts. These replace ad-hoc manual testing (open two tabs, type,
 * eyeball it) with scenarios that are hard to reliably trigger by hand:
 * simultaneous edits before either side has synced, N-way convergence,
 * awareness cleanup on disconnect, and the doc-teardown race the code's own
 * comments flag (ws.ts:156-159).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { docs, setPersistence, getPersistence } from './ws.js'
import { filePersistence } from './persistence.js'
import {
  connectAndSync,
  connectClient,
  disconnectAll,
  noopPersistence,
  performRandomEdits,
  sleep,
  startTestServer,
  uniqueRoom,
  waitForSync,
  waitUntilConverged,
  type TestServer,
} from './test-utils.js'

let server: TestServer

beforeAll(async () => {
  server = await startTestServer()
})

afterAll(async () => {
  await server.close()
})

beforeEach(() => {
  setPersistence(null)
})

describe('two-way sync', () => {
  it('converges when both clients edit before either has synced with the other', async () => {
    const room = uniqueRoom()
    const a = await connectAndSync(server.url, room)
    const b = await connectAndSync(server.url, room)

    // Both mutate immediately, racing each other over the wire.
    a.ytext.insert(0, 'AAAA')
    b.ytext.insert(0, 'BBBB')

    const finalText = await waitUntilConverged([
      () => a.ytext.toString(),
      () => b.ytext.toString(),
    ])

    expect(finalText).toHaveLength(8)
    expect(finalText).toContain('AAAA')
    expect(finalText).toContain('BBBB')

    disconnectAll([a, b])
  })

  it('a late-joining client receives the full existing document', async () => {
    const room = uniqueRoom()
    const a = await connectAndSync(server.url, room)
    a.ytext.insert(0, 'hello from client A')

    // Give the server a moment to have actually applied and could rebroadcast it.
    await sleep(50)

    const b = await connectAndSync(server.url, room)
    await waitUntilConverged([() => a.ytext.toString(), () => b.ytext.toString()])
    expect(b.ytext.toString()).toBe('hello from client A')

    disconnectAll([a, b])
  })
})

describe('N-way concurrent edits', () => {
  it('converges to an identical, lossless document across many concurrent editors (inserts only)', async () => {
    const room = uniqueRoom()
    const N = 8
    const opsPerClient = 12
    const clients = await Promise.all(
      Array.from({ length: N }, () => connectAndSync(server.url, room)),
    )

    const insertedCounts = await Promise.all(
      clients.map((c) => performRandomEdits(c.ytext, opsPerClient, { allowDeletes: false })),
    )
    const totalInserted = insertedCounts.reduce((a, b) => a + b, 0)

    const finalText = await waitUntilConverged(
      clients.map((c) => () => c.ytext.toString()),
      { timeoutMs: 10_000 },
    )

    // Insert-only means no character should ever be lost or duplicated.
    expect(finalText).toHaveLength(totalInserted)

    disconnectAll(clients)
  }, 15_000)

  it('converges (all clients agree) under concurrent inserts and deletes', async () => {
    const room = uniqueRoom()
    const N = 6
    const opsPerClient = 20
    const clients = await Promise.all(
      Array.from({ length: N }, () => connectAndSync(server.url, room)),
    )

    await Promise.all(clients.map((c) => performRandomEdits(c.ytext, opsPerClient)))

    // The exact result depends on CRDT tie-breaking, but every replica —
    // including any freshly-joined observer — must agree on it.
    const observer = await connectAndSync(server.url, room)
    const finalText = await waitUntilConverged(
      [...clients, observer].map((c) => () => c.ytext.toString()),
      { timeoutMs: 10_000 },
    )
    expect(observer.ytext.toString()).toBe(finalText)

    disconnectAll([...clients, observer])
  }, 15_000)
})

describe('awareness (presence)', () => {
  it('propagates local state to every connected peer', async () => {
    const room = uniqueRoom()
    const clients = await Promise.all(
      Array.from({ length: 3 }, () => connectAndSync(server.url, room)),
    )
    clients.forEach((c, i) => c.provider.awareness.setLocalStateField('user', { name: `user-${i}` }))

    await sleep(200) // let awareness updates propagate

    for (const c of clients) {
      expect(c.provider.awareness.getStates().size).toBe(clients.length)
    }

    disconnectAll(clients)
  })

  it('removes a client\'s awareness state from peers once it disconnects', async () => {
    const room = uniqueRoom()
    const a = await connectAndSync(server.url, room)
    const b = await connectAndSync(server.url, room)
    a.provider.awareness.setLocalStateField('user', { name: 'a' })
    b.provider.awareness.setLocalStateField('user', { name: 'b' })
    await sleep(200)
    expect(a.provider.awareness.getStates().size).toBe(2)

    b.provider.destroy() // not disconnect() — this is what clears its awareness entry
    b.ydoc.destroy()

    const start = Date.now()
    while (a.provider.awareness.getStates().size > 1 && Date.now() - start < 3000) {
      await sleep(25)
    }
    expect(a.provider.awareness.getStates().size).toBe(1)

    disconnectAll([a])
  })
})

describe('doc lifecycle', () => {
  // closeConn only frees a doc from the `docs` map when a persistence layer is
  // configured (ws.ts:155) — with none set, a room is kept in memory forever
  // once opened. That's real, current behavior (see the findings notes), not
  // a test bug — noopPersistence here isolates "does cleanup work at all"
  // from "does persistence itself work", which the tests below cover.
  beforeEach(() => setPersistence(noopPersistence))

  it('frees the in-memory doc once every connection has disconnected', async () => {
    const room = uniqueRoom()
    const a = await connectAndSync(server.url, room)
    expect(docs.has(room)).toBe(true)

    a.provider.destroy()
    a.ydoc.destroy()

    const start = Date.now()
    while (docs.has(room) && Date.now() - start < 2000) {
      await sleep(25)
    }
    expect(docs.has(room)).toBe(false)
  })

  it('keeps the doc alive in memory as long as at least one connection remains', async () => {
    const room = uniqueRoom()
    const a = await connectAndSync(server.url, room)
    const b = await connectAndSync(server.url, room)

    a.provider.destroy()
    a.ydoc.destroy()
    await sleep(200)

    expect(docs.has(room)).toBe(true) // b is still connected

    disconnectAll([b])
  })
})

describe('persistence race', () => {
  const dataDir = path.resolve(process.cwd(), 'data')
  const writtenFiles: string[] = []

  beforeEach(() => {
    setPersistence(filePersistence)
  })

  afterEach(async () => {
    setPersistence(null)
    await Promise.all(
      writtenFiles.splice(0).map((f) => fs.rm(f, { force: true })),
    )
  })

  it('persists to disk on last-connection-close and reloads it for a fresh room', async () => {
    const room = uniqueRoom('persist')
    writtenFiles.push(path.join(dataDir, `${room}.ydoc`))

    const a = await connectAndSync(server.url, room)
    a.ytext.insert(0, 'persisted content')
    a.provider.destroy()
    a.ydoc.destroy()

    // writeState is async (debounce-free flush, but still a promise) — poll for the file.
    const file = path.join(dataDir, `${room}.ydoc`)
    const start = Date.now()
    while (Date.now() - start < 3000) {
      try {
        await fs.access(file)
        break
      } catch {
        await sleep(25)
      }
    }

    const b = await connectAndSync(server.url, room)
    expect(b.ytext.toString()).toBe('persisted content')
    disconnectAll([b])
  })

  it('does not lose data when a new client connects immediately after the last one disconnects', async () => {
    // This targets the exact race called out in ws.ts's own comments: closeConn's
    // writeState()+destroy()+docs.delete() is async, so a reconnect landing before
    // that settles must not see a half-torn-down or stale-empty doc.
    const room = uniqueRoom('persist-race')
    writtenFiles.push(path.join(dataDir, `${room}.ydoc`))

    const a = await connectAndSync(server.url, room)
    a.ytext.insert(0, 'race content')
    a.provider.destroy()
    a.ydoc.destroy()

    // No delay: reconnect in the same tick the disconnect fires, before writeState
    // has necessarily resolved.
    const b = connectClient(server.url, room)
    await waitForSync(b.provider)

    // Whether b picks up the still-live in-memory doc or a freshly rehydrated one
    // from disk, it must end up with the content — never empty, never duplicated.
    const start = Date.now()
    while (b.ytext.toString() !== 'race content' && Date.now() - start < 3000) {
      await sleep(25)
    }
    expect(b.ytext.toString()).toBe('race content')

    disconnectAll([b])
  })
})

describe('persistence sanity', () => {
  it('setPersistence/getPersistence round-trip (no other test leaked a persistence impl)', () => {
    setPersistence(null)
    expect(getPersistence()).toBeNull()
    setPersistence(filePersistence)
    expect(getPersistence()).toBe(filePersistence)
    setPersistence(null)
  })
})
