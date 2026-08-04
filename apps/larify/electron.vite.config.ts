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
    optimizeDeps: {
      exclude: [
        '@codingame/monaco-vscode-api',
        '@codingame/monaco-vscode-configuration-service-override',
        '@codingame/monaco-vscode-css-default-extension',
        '@codingame/monaco-vscode-files-service-override',
        '@codingame/monaco-vscode-html-default-extension',
        '@codingame/monaco-vscode-json-default-extension',
        '@codingame/monaco-vscode-languages-service-override',
        '@codingame/monaco-vscode-markdown-basics-default-extension',
        '@codingame/monaco-vscode-model-service-override',
        '@codingame/monaco-vscode-textmate-service-override',
        '@codingame/monaco-vscode-theme-defaults-default-extension',
        '@codingame/monaco-vscode-theme-service-override',
        '@codingame/monaco-vscode-typescript-basics-default-extension',
        '@codingame/monaco-vscode-views-service-override'
      ]
    },
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
          index: resolve('src/renderer/index.html'),
          performance: resolve('src/renderer/performance.html'),
          workspaceEditor: resolve('src/renderer/workspace-editor.html')
        }
      }
    },
    worker: {
      format: 'es',
      plugins: () => [vscodeDiffBrowser()]
    }
  }
})
