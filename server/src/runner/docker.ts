import { PassThrough } from 'node:stream'
import tar from 'tar-stream'
import { docker, SANDBOX_IMAGE } from '../docker/client.js'

export interface SandboxResult {
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
}

export interface SandboxHandlers {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  /** Caller-supplied cancellation — the HTTP-route equivalent of Ctrl+C.
   *  Killing the container is the easy part; the point of a signal rather
   *  than exposing the container itself is that the caller never has to
   *  know container lifecycle details to cancel a run. */
  signal?: AbortSignal
}

// 10s wall-clock budget, enforced with a direct kill() rather than stop():
// stop() waits 10s for SIGTERM before it sends SIGKILL itself, which would
// double this to 20s for anything that ignores SIGTERM (e.g. an infinite
// CPU loop with no signal handler).
const RUN_TIMEOUT_MS = 60_000

// Every sandbox container carries this label, so a crash between create()
// and remove() (server killed mid-run, host rebooted) leaves something
// sweepStaleSandboxes() can find and clean up on the next boot.
export const SANDBOX_LABEL = 'together.sandbox'

function codeArchive(code: string): NodeJS.ReadableStream {
  const pack = tar.pack()
  pack.entry({ name: 'main.js', mode: 0o644 }, code)
  pack.finalize()
  // tar-stream v3's Pack implements streamx's Readable, which is runtime-
  // compatible with Node streams (pipe/on/read) but doesn't structurally
  // satisfy NodeJS.ReadableStream's type (missing isPaused/unpipe/wrap) —
  // which is exactly what dockerode's putArchive is typed to accept.
  return pack as unknown as NodeJS.ReadableStream
}

/** Runs `code` (plain JS — the caller transpiles TS first) to completion
 *  inside a fresh, locked-down node:20-alpine container, streaming stdout
 *  and stderr as they arrive. One container per call; always removed. */
export async function runInSandbox(code: string, handlers: SandboxHandlers = {}): Promise<SandboxResult> {
  const container = await docker.createContainer({
    Image: SANDBOX_IMAGE,
    Cmd: ['node', '/main.js'],
    // Never Tty: true — a pty merges stdout/stderr into one stream, which
    // is exactly the distinction the retry loop and the UI need kept apart.
    Tty: false,
    User: 'node',
    Labels: { [SANDBOX_LABEL]: 'true' },
    HostConfig: {
      Memory: 256 * 1024 * 1024,
      // Equal to Memory, not left at the Docker default (2x) — otherwise a
      // container can swap past the memory limit instead of being OOM-killed.
      MemorySwap: 256 * 1024 * 1024,
      NanoCpus: 500_000_000, // 0.5 CPU (1 CPU = 1e9)
      PidsLimit: 64,
      NetworkMode: 'none',
      CapDrop: ['ALL'],
      AutoRemove: false,
    },
  })

  try {
    await container.putArchive(codeArchive(code), { path: '/' })

    // Attach before start: logs({follow:true}) races a short-lived
    // container and can miss output written before the follow catches up.
    // attach() on a created-but-not-started container holds the connection
    // open and sees everything from the first byte.
    const stream = await container.attach({ stream: true, stdout: true, stderr: true })

    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.on('data', (chunk: Buffer) => handlers.onStdout?.(chunk.toString('utf8')))
    stderr.on('data', (chunk: Buffer) => handlers.onStderr?.(chunk.toString('utf8')))
    docker.modem.demuxStream(stream, stdout, stderr)

    await container.start()

    let timedOut = false
    let aborted = false
    // A kill that's already in flight (or already landed) when a second
    // one arrives is fine — dockerode rejects killing a dead container,
    // and that rejection is swallowed the same way both callers.
    const kill = () => container.kill().catch(() => {})

    const killTimer = setTimeout(() => {
      timedOut = true
      kill()
    }, RUN_TIMEOUT_MS)

    const onAbort = () => {
      aborted = true
      kill()
    }
    handlers.signal?.addEventListener('abort', onAbort, { once: true })
    // The signal can already be aborted by the time we get here (start()
    // awaited above takes real time) — addEventListener won't fire for an
    // event that already happened, so check explicitly too.
    if (handlers.signal?.aborted) onAbort()

    try {
      const { StatusCode } = await container.wait()
      return { exitCode: StatusCode, timedOut, aborted }
    } finally {
      clearTimeout(killTimer)
      handlers.signal?.removeEventListener('abort', onAbort)
    }
  } finally {
    await container.remove({ force: true }).catch(() => {})
  }
}

/** Removes any sandbox container left over from a server crash mid-run.
 *  Call once at boot, alongside ensureImagePulled. Swallows a dead daemon
 *  the same way ensureImagePulled does — this runs un-awaited at startup,
 *  so letting it throw would surface as an unhandled rejection that kills
 *  the whole process, not as the UI banner a dead daemon should be. */
export async function sweepStaleSandboxes(): Promise<number> {
  try {
    const stale = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [SANDBOX_LABEL] }),
    })
    await Promise.all(stale.map((c) => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})))
    return stale.length
  } catch (err) {
    console.warn(`[docker] could not sweep stale sandboxes: ${(err as Error).message}`)
    return 0
  }
}
