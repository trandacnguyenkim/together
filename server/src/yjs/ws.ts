/**
 * Vendored from https://github.com/yjs/y-websocket-server (src/utils.js).
 *
 * y-websocket@3.x removed its bundled server (`y-websocket/bin/utils` no
 * longer resolves — the package's exports are now just "."). The documented
 * successor, @y/websocket-server, targets the Yjs v14 prerelease line
 * (@y/protocols, @y/y), which is incompatible with the yjs@13 / y-monaco
 * pairing this project depends on. So this file is vendored directly rather
 * than installed, with two changes from upstream:
 *
 *   1. @y/protocols/* -> y-protocols/*  (the yjs@13-compatible package)
 *   2. The optional webhook-callback hook (`./callback.js`, COMBINED with an
 *      eventloop debouncer) is dropped — this project has no use for it and
 *      it would be dead code pulling in an extra file for no reason.
 *
 * Behavior is otherwise identical to upstream: this owns the `docs` map,
 * `getYDoc`, `setupWSConnection`, and `setPersistence` that the rest of the
 * server (AI write-back, file persistence) depends on directly.
 */
import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as map from 'lib0/map'

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

// Disable gc when using snapshots! (matches upstream default: on unless
// explicitly disabled via env)
const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0'

export interface Persistence {
  bindState: (docName: string, doc: WSSharedDoc) => Promise<void>
  writeState: (docName: string, doc: WSSharedDoc) => Promise<unknown>
}

let persistence: Persistence | null = null

export const setPersistence = (persistence_: Persistence | null) => {
  persistence = persistence_
}

export const getPersistence = (): Persistence | null => persistence

export const docs = new Map<string, WSSharedDoc>()

const messageSync = 0
const messageAwareness = 1

const updateHandler = (update: Uint8Array, _origin: unknown, doc: WSSharedDoc) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeUpdate(encoder, update)
  const message = encoding.toUint8Array(encoder)
  doc.conns.forEach((_, conn) => send(doc, conn, message))
}

export class WSSharedDoc extends Y.Doc {
  name: string
  /** conn -> set of awareness client ids that connection controls */
  conns: Map<WebSocket, Set<number>>
  awareness: awarenessProtocol.Awareness
  whenLoaded: Promise<void> = Promise.resolve()

  constructor(name: string) {
    super({ gc: gcEnabled })
    this.name = name
    this.conns = new Map()
    this.awareness = new awarenessProtocol.Awareness(this)
    this.awareness.setLocalState(null)

    const awarenessChangeHandler = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      conn: WebSocket | null,
    ) => {
      const changedClients = added.concat(updated, removed)
      if (conn !== null) {
        const connControlledIds = this.conns.get(conn)
        if (connControlledIds !== undefined) {
          added.forEach((clientId) => connControlledIds.add(clientId))
          removed.forEach((clientId) => connControlledIds.delete(clientId))
        }
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      )
      const buff = encoding.toUint8Array(encoder)
      this.conns.forEach((_, c) => send(this, c, buff))
    }

    this.awareness.on('update', awarenessChangeHandler)
    this.on('update', updateHandler as (...args: unknown[]) => void)
  }
}

/**
 * Gets a Y.Doc by name, whether in memory or freshly created (and, if a
 * persistence layer is registered, hydrated from disk via `bindState`).
 */
export const getYDoc = (docName: string, gc = true): WSSharedDoc =>
  map.setIfUndefined(docs, docName, () => {
    const doc = new WSSharedDoc(docName)
    doc.gc = gc
    if (persistence !== null) {
      doc.whenLoaded = persistence.bindState(docName, doc)
    }
    docs.set(docName, doc)
    return doc
  })

const messageListener = (conn: WebSocket, doc: WSSharedDoc, message: Uint8Array) => {
  try {
    const encoder = encoding.createEncoder()
    const decoder = decoding.createDecoder(message)
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
        // If `encoder` only contains the message type (length 1), there's
        // nothing worth sending back.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder))
        }
        break
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        )
        break
      }
    }
  } catch (err) {
    console.error(err)
    // 'error' isn't in Y.Doc's typed event map, but emit is untyped enough
    // at runtime to carry it; matches upstream's own @ts-ignore here.
    // @ts-expect-error
    doc.emit('error', [err])
  }
}

const closeConn = (doc: WSSharedDoc, conn: WebSocket) => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn) as Set<number>
    doc.conns.delete(conn)
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null)
    if (doc.conns.size === 0 && persistence !== null) {
      // Last connection dropped: persist and free the doc. (Note: if an AI
      // generation job is still writing to this doc when the last tab
      // closes, this races the write — see the AI route, which refcounts
      // active jobs and skips this path while one is in flight.)
      persistence.writeState(doc.name, doc).then(() => {
        doc.destroy()
        docs.delete(doc.name)
      })
      
    }
  }
  conn.close()
}

const send = (doc: WSSharedDoc, conn: WebSocket, m: Uint8Array) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn)
    return
  }
  try {
    conn.send(m, {}, (err) => {
      if (err != null) closeConn(doc, conn)
    })
  } catch (e) {
    closeConn(doc, conn)
  }
}

const pingTimeout = 30000

export interface SetupWSConnectionOptions {
  docName: string
  gc?: boolean
}

export const setupWSConnection = async (
  conn: WebSocket,
  _req: IncomingMessage,
  { docName, gc = true }: SetupWSConnectionOptions,
) => {
  conn.binaryType = 'arraybuffer'
  const doc = getYDoc(docName, gc)
  doc.conns.set(conn, new Set())

  conn.on('message', (message: ArrayBuffer) =>
    void doc.whenLoaded.then(() => messageListener(conn, doc, new Uint8Array(message))),
  )

  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn)
      clearInterval(pingInterval)
    } else if (doc.conns.has(conn)) {
      pongReceived = false
      try {
        conn.ping()
      } catch {
        closeConn(doc, conn)
        clearInterval(pingInterval)
      }
    }
  }, pingTimeout)

  conn.on('close', () => {
    closeConn(doc, conn)
    clearInterval(pingInterval)
  })
  conn.on('pong', () => {
    pongReceived = true
  })

  {
    // Send sync step 1 + current awareness state to the new connection.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, doc)
    send(doc, conn, encoding.toUint8Array(encoder))
    const awarenessStates = doc.awareness.getStates()
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, messageAwareness)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
      )
      send(doc, conn, encoding.toUint8Array(awarenessEncoder))
    }
  }
}
