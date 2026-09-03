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
      minify: true,
      sourcemap: false,
      rollupOptions: {
        // undici 需 external：它的 setGlobalDispatcher 要与 Node 内置 fetch 共享
        // 全局 dispatcher（依赖运行时同一份 undici），打包会切成副本导致不共享。
        external: ['canvas', 'undici']
      }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      minify: true,
      sourcemap: false
    }
  },
  renderer: {
    server: {
      fs: {
        allow: [resolve('../..')]
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vscodeDiffBrowser(), react(), tailwindcss()],
    build: {
      minify: true,
      sourcemap: false,
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
