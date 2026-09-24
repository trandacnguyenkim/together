/**
 * Load/stress tests for ws.ts. Kept separate from ws.concurrency.test.ts
 * (see the `test:stress` script) because these intentionally push volume —
 * connection count, op count, payload size — rather than just correctness,
 * so they run slower and are noisier to run on every save.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { docs, setPersistence } from './ws.js'
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
  setPersistence(null) // isolate wire/CRDT behavior from disk I/O for these
})

describe('load: many concurrent editors', () => {
  it(
    'converges losslessly with 40 simultaneous editors making 25 inserts each',
    async () => {
      const room = uniqueRoom('stress-editors')
      const N = 40
      const opsPerClient = 25

      const t0 = Date.now()
      const clients = await Promise.all(
        Array.from({ length: N }, () => connectAndSync(server.url, room)),
      )
      const connectMs = Date.now() - t0

      const t1 = Date.now()
      const insertedCounts = await Promise.all(
        clients.map((c) => performRandomEdits(c.ytext, opsPerClient, { allowDeletes: false })),
      )
      const totalInserted = insertedCounts.reduce((a, b) => a + b, 0)

      const finalText = await waitUntilConverged(
        clients.map((c) => () => c.ytext.toString()),
        { timeoutMs: 20_000 },
      )
      const convergeMs = Date.now() - t1

      console.log(
        `[stress] ${N} clients x ${opsPerClient} ops: connect=${connectMs}ms, ` +
          `edit+converge=${convergeMs}ms, finalLength=${finalText.length}`,
      )

      expect(finalText).toHaveLength(totalInserted)

      disconnectAll(clients)
    },
    30_000,
  )

  it(
    'a single large paste (500KB) reaches a brand-new client intact',
    async () => {
      const room = uniqueRoom('stress-large')
      const writer = await connectAndSync(server.url, room)

      const chunk = 'x'.repeat(500_000)
      writer.ytext.insert(0, chunk)

      const reader = await connectAndSync(server.url, room)
      const start = Date.now()
      while (reader.ytext.length !== chunk.length && Date.now() - start < 10_000) {
        await sleep(50)
      }

      expect(reader.ytext.length).toBe(chunk.length)
      expect(reader.ytext.toString()).toBe(chunk)

      disconnectAll([writer, reader])
    },
    15_000,
  )
})

describe('load: connection churn', () => {
  // docs are only ever freed from memory when a persistence layer is configured
  // (ws.ts:155) — see ws.concurrency.test.ts's "doc lifecycle" block.
  beforeEach(() => setPersistence(noopPersistence))

  it(
    'survives 150 rapid connect/disconnect cycles on one room without leaking docs or connections',
    async () => {
      const room = uniqueRoom('stress-churn')
      const cycles = 150

      for (let i = 0; i < cycles; i++) {
        const c = connectClient(server.url, room)
        await waitForSync(c.provider)
        c.ytext.insert(0, 'x') // touch the doc so there's something to relay/persist-check
        c.provider.destroy()
        c.ydoc.destroy()
      }

      const start = Date.now()
      while (docs.has(room) && Date.now() - start < 3000) {
        await sleep(25)
      }
      expect(docs.has(room)).toBe(false)
    },
    30_000,
  )

  it(
    'many rooms opened and closed concurrently all clean up independently',
    async () => {
      const roomCount = 50
      const rooms = Array.from({ length: roomCount }, () => uniqueRoom('stress-multiroom'))

      const clients = await Promise.all(rooms.map((r) => connectAndSync(server.url, r)))
      clients.forEach((c) => c.ytext.insert(0, 'hi'))
      await sleep(100)

      disconnectAll(clients)

      const start = Date.now()
      while (rooms.some((r) => docs.has(r)) && Date.now() - start < 3000) {
        await sleep(25)
      }
      for (const r of rooms) {
        expect(docs.has(r)).toBe(false)
      }
    },
    15_000,
  )
})

describe('load: awareness churn', () => {
  it(
    'presence state for 60 rapidly-changing clients converges without leaks',
    async () => {
      const room = uniqueRoom('stress-awareness')
      const N = 60
      const clients = await Promise.all(
        Array.from({ length: N }, () => connectAndSync(server.url, room)),
      )

      // Every client flips its state a few times in quick succession.
      await Promise.all(
        clients.map(async (c, i) => {
          for (let r = 0; r < 5; r++) {
            c.provider.awareness.setLocalStateField('user', { name: `u${i}`, tick: r })
            await sleep(Math.random() * 10)
          }
        }),
      )

      const observer = clients[0]
      const start = Date.now()
      while (observer.provider.awareness.getStates().size < N && Date.now() - start < 5000) {
        await sleep(25)
      }
      expect(observer.provider.awareness.getStates().size).toBe(N)

      // Disconnect half of them and confirm the survivors' view shrinks accordingly.
      const [toDrop, toKeep] = [clients.slice(0, N / 2), clients.slice(N / 2)]
      disconnectAll(toDrop)

      const start2 = Date.now()
      while (
        toKeep[0].provider.awareness.getStates().size > toKeep.length &&
        Date.now() - start2 < 5000
      ) {
        await sleep(25)
      }
      expect(toKeep[0].provider.awareness.getStates().size).toBe(toKeep.length)

      disconnectAll(toKeep)
    },
    20_000,
  )
})
