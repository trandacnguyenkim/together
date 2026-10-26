import { Router, type Response } from 'express'
import { z } from 'zod'
import * as esbuild from 'esbuild'
import { getYDoc } from '../yjs/ws.js'
import { checkDockerStatus, SANDBOX_IMAGE } from '../docker/client.js'
import { runInSandbox } from '../runner/docker.js'

export const RunRouter = Router()

const requestSchema = z.object({
  room: z.string().min(1),
})

function sseWrite(res: Response, event: string, data: unknown) {
  // The client (Stop button, or just a closed tab) can disconnect mid-run;
  // the run keeps going until the container actually dies, so later writes
  // land on an already-ended response. Writing after end throws — and an
  // uncaught throw here crashes the server the same way the unguarded
  // sweepStaleSandboxes call did.
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function isTransformFailure(err: unknown): err is esbuild.TransformFailure {
  return Boolean(err) && typeof err === 'object' && Array.isArray((err as { errors?: unknown }).errors)
}

function formatEsbuildError(err: unknown): string {
  if (isTransformFailure(err)) {
    return err.errors
      .map((e) => {
        const loc = e.location
        return loc ? `${loc.line}:${loc.column}: ${e.text}\n  ${loc.lineText}` : e.text
      })
      .join('\n')
  }
  return (err as Error).message ?? 'unknown compile error'
}

RunRouter.post('/run', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message })
  }

  const status = await checkDockerStatus()
  if (!status.daemonReachable) {
    return res.status(503).json({ error: 'Docker is not running. Start Docker Desktop and try again.' })
  }
  if (!status.imagePresent) {
    return res
      .status(503)
      .json({ error: `Sandbox image ${SANDBOX_IMAGE} isn't pulled yet — give it a moment and try again.` })
  }

  const { room } = parsed.data
  const source = getYDoc(room).getText('monaco').toString()

  let code: string
  try {
    const result = await esbuild.transform(source, { loader: 'ts', target: 'node20' })
    code = result.code
  } catch (err) {
    return res.status(400).json({ error: 'code failed to compile', detail: formatEsbuildError(err) })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  // A write to a response whose socket already errored out (client killed
  // the connection hard, not just a clean abort) emits 'error' instead of
  // throwing — same crash risk as an unhandled rejection if nothing's
  // listening.
  res.on('error', () => {})

  // The Stop button (and a closed tab) reach us as "the request closed" —
  // there's no direct "cancel this run" API, so this is the Ctrl+C
  // equivalent: notice the connection is gone and translate that into
  // killing the container that was serving it.
  const controller = new AbortController()
  req.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    const result = await runInSandbox(code, {
      signal: controller.signal,
      onStdout: (chunk) => sseWrite(res, 'stdout', { chunk }),
      onStderr: (chunk) => sseWrite(res, 'stderr', { chunk }),
    })
    sseWrite(res, 'done', result)
  } catch (err) {
    sseWrite(res, 'error', { message: (err as Error).message })
  } finally {
    res.end()
  }
})
