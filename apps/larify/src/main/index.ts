import { app, type BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createApp, Loader } from 'kernel'
import type { Extension } from 'kernel'
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
