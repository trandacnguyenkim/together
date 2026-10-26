# together

A real-time collaborative code editor with an AI pair programmer and a sandboxed "Run" button —
multiple people edit one document with live cursors, an AI panel proposes edits you review and
accept/reject, and your code runs isolated in a throwaway Docker container.

**Live:** https://shorturl.at/6Hkb9 — open the same room URL (e.g. append `/demo`) in two
tabs to see collaboration in action.

## Features

- **Live collaboration** — Monaco editor bound to a Yjs CRDT document over WebSocket. Multiple tabs
  on the same room URL see each other's edits and cursors (with name + color) in real time, and
  survive a server restart (debounced snapshot to disk).
- **AI pair programmer** — select code (or just place your cursor) and ask the AI panel a question.
  It either proposes an edit (shown as a diff-style preview you Accept/Reject) or answers in plain
  text, depending on what you asked.
- **Sandboxed terminal** — click Run to execute the room's current code inside a fresh, locked-down
  `node:20-alpine` container: no network access, capped memory/CPU, dropped capabilities, non-root
  user. Output streams back live, stderr shown distinctly from stdout. Click Stop to cancel a run
  early, or it's auto-killed after a timeout either way.
- Light/dark pixel-art theme.

## Architecture

```
client (Vite + React)                  server (Express + ws, :3001)
┌─────────────────────────┐            ┌──────────────────────────────────┐
│ Monaco ◀── MonacoBinding │◀── ws ────▶│ /yjs/:room   vendored Y.js WS srv │
│   awareness cursors      │            │   docs: Map<room, Y.Doc>         │
│ AI panel  ──── POST ────▶│            │   snapshot → data/<room>.ydoc    │
│ Terminal  ◀── SSE ───────│◀── POST ───│ /api/ai      Groq → propose edit │
└───────────────────────────┘           │ /api/run     dockerode sandbox   │
                                         │ /api/health  boot-check status   │
                                         └──────────────────────────────────┘
```

- **`server/src/yjs/ws.ts`** — a vendored Yjs WebSocket server (`y-websocket`'s server bundle isn't
  published for the Yjs version this project uses), handling per-room docs and awareness.
- **`server/src/yjs/persistence.ts`** — debounced, atomic (write-then-rename) snapshots to
  `server/data/<room>.ydoc`, so a crash mid-write can't corrupt a room's saved state.
- **`server/src/routes/ai.ts`** — calls Groq with a tool-calling schema that forces either a
  `propose_edit` (explanation + replacement text, anchored to a Yjs relative position so it still
  applies correctly even if the document changed while you were typing the prompt) or a
  `respond_text` reply.
- **`server/src/runner/docker.ts`** — creates a container, copies the code in via a tar archive,
  attaches to stdout/stderr *before* starting it (so a short-lived container's early output isn't
  missed), and always removes the container afterward. Supports both a timeout and an
  `AbortSignal`-based cancel (wired to the Stop button via the HTTP request closing).

## Local setup

**Prerequisites:**
- Node >= 20
- Docker Desktop running (needed for the sandbox feature; the rest of the app works without it)
- A [Groq API key](https://console.groq.com/keys)

```bash
npm install
cp .env.example server/.env   # then fill in GROQ_API_KEY
npm run dev
```

This starts both the client (`:5173`, proxies `/api` and `/yjs` to the server) and the server
(`:3001`). Open two browser tabs on the same room URL (e.g. `localhost:5173/myroom`) to see
collaboration in action.

**Env vars** (`server/.env`):
| Var | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | Yes | AI panel won't work without it (rest of the app still does). |
| `DOCKER_SOCKET` | No | Only needed if Docker's socket isn't at the default `/var/run/docker.sock` — e.g. on some Docker Desktop for Mac setups it's at `~/.docker/run/docker.sock` instead (use the literal absolute path, not `~`). |
| `PORT` | No | Defaults to 3001. |

## Deployment

Deployed as a plain Linux VM rather than a serverless/static host, because the sandbox feature needs
a real Docker daemon that the server can talk to directly — most managed app platforms deliberately
don't expose that.

Rough shape: a small VM (e.g. a DigitalOcean droplet) with Docker + Node installed, this repo cloned
and built (`npm install && npm run build --workspace=client && npm run build --workspace=server`),
the server run as a systemd service (auto-restart, survives reboots), and
[Caddy](https://caddyserver.com) in front as a reverse proxy — serving `client/dist` as static files,
forwarding `/api/*` and `/yjs/*` to the Node server, and handling HTTPS automatically.