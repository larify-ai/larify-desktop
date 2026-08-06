import type { App } from 'electron'

export function installShutdown(app: App, dispose: () => void | Promise<void>): void {
  let shuttingDown = false

  app.on('before-quit', (event) => {
    if (shuttingDown) return
    shuttingDown = true
    event.preventDefault()

    void Promise.resolve(dispose())
      .catch((error) => console.error('[shutdown]', error))
      .finally(() => app.quit())
  })
}
