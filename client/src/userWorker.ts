/**
 * Monaco worker setup for Vite.
 *
 * The worker snippet in Monaco's own ESM/Vite docs calls
 * `self.MonacoEnvironment.getWorkerUrl` without ever defining it, which
 * throws `getWorkerUrl is not a function` and silently falls back to
 * main-thread language services — the editor still works, but IntelliSense
 * quietly disappears. This follows the actually-correct sample instead:
 * https://github.com/microsoft/monaco-editor/blob/main/samples/browser-esm-vite-react/src/userWorker.ts
 *
 * Only JS/TS workers are wired up — this app only ever edits JS/TS/JSX/TSX,
 * so json/css/html workers would be dead weight.
 *
 * This module must be imported (for its side effects) before any
 * `monaco-editor` import elsewhere in the app, and Monaco must stay out of
 * vite.config.ts's `optimizeDeps.include` — see vite.config.ts.
 */
// monaco-editor@0.56.0's package.json `exports` map only exposes `./*` ->
// `./esm/vs/*.js` (no `esm/` passthrough), so the import path omits the
// `esm/vs` segment the map already inserts — `monaco-editor/esm/vs/...`
// 404s at resolution time even though the file exists on disk at that path.
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  },
}
