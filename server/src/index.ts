import 'dotenv/config'
import http from 'node:http'
import { URL } from 'node:url'
import express from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import { setupWSConnection, setPersistence, docs } from './yjs/ws.js'
import { filePersistence, flushAllOnExit } from './yjs/persistence.js'
import { ensureImagePulled } from './docker/client.js'
import { healthRouter } from './routes/health.js'

const PORT = Number(process.env.PORT ?? 3001)

setPersistence(filePersistence)

const app = express()
app.use(express.json())
app.use('/api', healthRouter)

const server = http.createServer(app)

// A manual `upgrade` handler with `noServer: true`, rather than
// `new WebSocketServer({ server })` — the latter claims every upgrade on
// the port, which would fight Vite's own HMR socket if this server is ever
// proxied to in dev.
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
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    setupWSConnection(ws, req, { docName })
  })
})

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})

// Boot-time checks that become UI banners, not runtime 500s.
void ensureImagePulled()
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[server] ANTHROPIC_API_KEY is not set — the AI panel will be unavailable.')
}
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.warn('[server] CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — Deploy will be unavailable.')
}

const shutdown = async () => {
  console.log('[server] shutting down, flushing pending Yjs snapshots...')
  await flushAllOnExit(docs)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
