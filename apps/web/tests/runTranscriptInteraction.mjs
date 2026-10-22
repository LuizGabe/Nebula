import { createRequire } from 'node:module'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Reuse Vite's compiler, including its JSX transform, without starting a server.
const require = createRequire(import.meta.url)
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
const web = fileURLToPath(new URL('../', import.meta.url))
const cache = path.join(web, 'node_modules', '.cache')
await mkdir(cache, { recursive: true })
const outfile = path.join(cache, `transcript-${randomUUID()}.mjs`)
try {
  await build({
    absWorkingDir: web,
    entryPoints: [process.argv[2] ?? 'tests/transcriptInteraction.test.tsx'],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.svg': 'text' },
    define: { 'import.meta.env': JSON.stringify({ VITE_API_BASE_URL: 'http://localhost:3001' }) },
    logLevel: 'silent',
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(outfile, { force: true })
}
