import { app, type BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { BuiltinExtensionSource, builtinModules, ExtensionHost } from '@shared/extension'
import { discoverExtensions } from '../shared/discover-extensions'
import { createApp } from '../shared/host'
import { Loader } from '../shared/loader'
import type { Extension as LegacyExtension } from '../shared/types'
import { installGracefulShutdown } from './utils/graceful-shutdown'
import { SessionStore } from './core/session'
import { sessionDatabasePath } from './utils/app-paths'

const { extensions, loaders } = discoverExtensions(
  builtinModules as unknown as Record<string, () => Promise<{ default: LegacyExtension }>>
)
const migratedExtensionNames = new Set(['fs', 'worker'])
const legacyExtensions = extensions.filter(({ id }) => !migratedExtensionNames.has(id))
const migratedModules = Object.fromEntries(
  Object.entries(builtinModules).filter(([path]) =>
    [...migratedExtensionNames].some((name) =>
      path.replaceAll('\\', '/').includes(`/extensions/${name}/main/`)
    )
  )
)

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'MacWebContentsOcclusion')
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ai.larify.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const host = createApp()
  const sessions = new SessionStore(sessionDatabasePath())
  host.register('service', 'session', sessions)
  const loader = new Loader(host, (m) => loaders.get(m.id)!())
  const extensionHost = new ExtensionHost()
  const discovered = await new BuiltinExtensionSource(migratedModules).discover()
  const migrated = (await Promise.all(discovered.map((loader) => loader.load()))).filter(
    ({ name }) => migratedExtensionNames.has(name)
  )
  if (migrated.length !== migratedExtensionNames.size) {
    throw new Error('Not all migrated extensions were discovered')
  }
  for (const extension of migrated) await extensionHost.activate(extension)

  const shell = legacyExtensions.find(({ id }) => id === 'shell')
  if (!shell) throw new Error('shell extension is not registered')

  await loader.load(shell)

  const deferredIds = new Set(['browser', 'workspace'])
  const immediate = legacyExtensions.filter(({ id }) => id !== shell.id && !deferredIds.has(id))
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
      await Promise.all([...migratedExtensionNames].map((name) => extensionHost.deactivate(name)))
      await loader.unloadAll()
      sessions.close()
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

  installGracefulShutdown(app, async () => {
    await Promise.all([...migratedExtensionNames].map((name) => extensionHost.deactivate(name)))
    await loader.unloadAll()
    sessions.close()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
