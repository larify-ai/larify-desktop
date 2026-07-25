import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['kernel', 'defuddle'] },
      rollupOptions: {
        external: ['canvas']
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ['kernel'] }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    worker: {
      format: 'es'
    }
  }
})
