import type { App } from 'electron'
import type { Application } from '../app/application'
import { createWindow } from './create'
import { windowToken } from './token'
import type { MainWindow } from './types'

export function registerWindow(application: Application): void {
  application.registry.register(windowToken, application.window)
}

export function openMainWindow(app: App): MainWindow {
  let window = createWindow()
  const activate = (): void => {
    if (window.isDestroyed()) window = createWindow()
  }
  app.on('activate', activate)
  return {
    get: () => window,
    dispose() {
      app.removeListener('activate', activate)
      if (!window.isDestroyed()) window.destroy()
    }
  }
}
