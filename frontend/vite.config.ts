import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// Replay provenance identifies source at server startup/build, not a moving HMR snapshot.
const sourceRoot = fileURLToPath(new URL('./src', import.meta.url))
function motionSourceHash(): string {
  const files: string[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|tsx|css|json)$/.test(entry.name)) files.push(path)
    }
  }
  walk(sourceRoot)
  const hash = createHash('sha256')
  for (const path of files.sort()) hash.update(relative(sourceRoot, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path)).update('\0')
  return hash.digest('hex')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_MOTION_SOURCE_HASH': JSON.stringify(motionSourceHash()),
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  server: {
    // F5-0 DEV benchmark cần cross-origin isolation để đo WASM multi-thread thật.
    // Toàn bộ runtime/model vẫn self-host; production headers thuộc deployment gate riêng.
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
