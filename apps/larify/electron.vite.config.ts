import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const vscodeDiffBrowser = (): Plugin => ({
  name: 'vscode-diff-browser',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (
      source === 'node:fs/promises' &&
      importer?.replaceAll('\\', '/').includes('/@vscode/diff/dist/wire.js')
    ) {
      return '\0vscode-diff-browser-fs'
    }
    return undefined
  },
  load(id: string) {
    if (id !== '\0vscode-diff-browser-fs') return undefined
    return `
      export async function readFile(url) {
        const response = await fetch(url)
        if (!response.ok) throw new Error(\`Unable to load diff WASM: \${response.status}\`)
        return new Uint8Array(await response.arrayBuffer())
      }
    `
  }
})

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        external: ['canvas']
      }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vscodeDiffBrowser(), react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    },
    worker: {
      format: 'es',
      plugins: () => [vscodeDiffBrowser()]
    }
  }
})
