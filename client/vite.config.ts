import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Monaco is deliberately absent from optimizeDeps here — pre-bundling it
// (and its `?worker` imports) causes worker-resolution failures. See
// src/userWorker.ts for the worker setup this depends on.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // y-monaco (unmaintained since 2024) imports this exact deep path,
      // which monaco-editor@0.56.0's `exports` map added after y-monaco's
      // last release and now blocks entirely (deep esm/vs/* imports 404 at
      // resolution). editor.api.js's export list is identical to what the
      // root `monaco-editor` entry re-exports, so redirecting here is exact
      // — not a workaround — and it has the added benefit of making
      // y-monaco share the same Monaco module instance Editor.tsx uses,
      // rather than a second one (see the @monaco-editor/react CDN-realm
      // trap this project avoids for the same reason).
      {
        find: 'monaco-editor/esm/vs/editor/editor.api.js',
        replacement: 'monaco-editor',
      },
    ],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/yjs': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
