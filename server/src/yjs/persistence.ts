/**
 * Debounced, atomic file-snapshot persistence for Y.Docs — deliberately not
 * y-leveldb. The native build is fine on modern Node/macOS, but LevelDB
 * takes an exclusive directory lock that fights `tsx watch` restarts
 * (`LOCK: Resource temporarily unavailable`), which will happen many times a
 * day during development. A snapshot file is ~25 lines and inspectable with
 * `rm`/`cat`.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import type { Persistence, WSSharedDoc } from './ws.js'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const DEBOUNCE_MS = 1500

// docName comes straight off the WebSocket URL path — never trust it as a
// filesystem path unsanitized.
const sanitize = (docName: string): string => {
  const clean = docName.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!clean) throw new Error(`invalid room name: ${JSON.stringify(docName)}`)
  return clean
}

const filePath = (docName: string) => path.join(DATA_DIR, `${sanitize(docName)}.ydoc`)

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()

/** Write is atomic: write to a temp file, then rename over the real path.
 *  A crash mid-write on a non-atomic write corrupts the snapshot, and a
 *  corrupt file throws on the next `Y.applyUpdate`, permanently bricking
 *  the room — so this path matters more than it looks like it should. */
const writeSnapshot = async (docName: string, doc: WSSharedDoc): Promise<void> => {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const dest = filePath(docName)
  const tmp = `${dest}.tmp`
  const update = Y.encodeStateAsUpdate(doc)
  await fs.writeFile(tmp, update)
  await fs.rename(tmp, dest)
}

const scheduleWrite = (docName: string, doc: WSSharedDoc) => {
  const existing = pendingWrites.get(docName)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingWrites.delete(docName)
    writeSnapshot(docName, doc).catch((err) => {
      console.error(`[persistence] failed to write snapshot for room "${docName}":`, err)
    })
  }, DEBOUNCE_MS)
  pendingWrites.set(docName, timer)
}

/** Force an immediate (non-debounced) flush — used on last-connection-close
 *  and on SIGINT/SIGTERM so a clean shutdown never loses the debounce window. */
const flushNow = async (docName: string, doc: WSSharedDoc): Promise<void> => {
  const existing = pendingWrites.get(docName)
  if (existing) {
    clearTimeout(existing)
    pendingWrites.delete(docName)
  }
  await writeSnapshot(docName, doc)
}

export const filePersistence: Persistence = {
  bindState: async (docName, doc) : Promise<void> => {
    const dest = filePath(docName)
    await fs.readFile(dest)
      .then((buf) => {
        Y.applyUpdate(doc, buf, 'persistence')
      })
      .catch((err) => {
        if (err.code !== 'ENOENT') {
          console.error(`[persistence] failed to load snapshot for room "${docName}":`, err)
        }
        // ENOENT is the expected case for a brand-new room.
      })

    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === 'persistence') return // loopback from our own applyUpdate above
      scheduleWrite(docName, doc)
    })
  },
  writeState: (docName, doc) => flushNow(docName, doc),
}

/** All currently-active rooms, for the SIGINT/SIGTERM flush-on-exit hook in index.ts. */
export const activeDocs = (docs: Map<string, WSSharedDoc>) => docs

export const flushAllOnExit = async (docs: Map<string, WSSharedDoc>): Promise<void> => {
  await Promise.all(
    Array.from(docs.entries()).map(([docName, doc]) =>
      flushNow(docName, doc).catch((err) =>
        console.error(`[persistence] flush-on-exit failed for room "${docName}":`, err),
      ),
    ),
  )
}
