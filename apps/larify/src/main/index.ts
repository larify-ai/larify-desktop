import { app, type BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createApp, Loader } from '@shared/extension'
import type { Extension } from '@shared/extension'
import { discoverExtensions } from '../shared/discover-extensions'
import { installGracefulShutdown } from './utils/graceful-shutdown'

const modules = import.meta.glob<{ default: Extension }>('../extensions/*/main/index.ts')
const { extensions, loaders } = discoverExtensions(modules)

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'MacWebContentsOcclusion')
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ai.larify.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const host = createApp()
  const loader = new Loader(host, (m) => loaders.get(m.id)!())
  const shell = extensions.find(({ id }) => id === 'shell')
  if (!shell) throw new Error('shell extension is not registered')

  await loader.load(shell)

  const deferredIds = new Set(['browser', 'workspace'])
  const immediate = extensions.filter(({ id }) => id !== shell.id && !deferredIds.has(id))
  await loader.loadAll(immediate)

  const deferred = extensions.filter(({ id }) => deferredIds.has(id))
  const nestIndex = process.argv.indexOf('--nest-run')
  if (nestIndex >= 0) {
    const taskFile = process.argv[nestIndex + 1]
    let exitCode = 0
    try {
      if (!taskFile) throw new Error('Expected a task.md path after --nest-run')
      await loader.loadAll(deferred)
      const { runPlayground } = await import('../extensions/nest/loop/run-playground')
      await runPlayground(host, taskFile)
    } catch (error) {
      exitCode = 1
      console.error('[nest]', error)
    } finally {
      await loader.unloadAll()
      app.exit(exitCode)
    }
    return
  }

  const mainWindow = host.get<{ get(): BrowserWindow }>('service', 'main-window')?.get()
  const loadDeferred = (): void => {
    void loader.loadAll(deferred).catch((error) => {
      console.error('[extensions:deferred]', error)
    })
  }
  if (mainWindow?.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', loadDeferred)
  } else {
    loadDeferred()
  }

  installGracefulShutdown(app, () => loader.unloadAll())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
