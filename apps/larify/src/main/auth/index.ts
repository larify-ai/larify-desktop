import { ipcMain } from 'electron'
import { defineService } from '@shared/infra/registry'

import type { Application } from '../app/application'
import { AuthService } from './service'

const authToken = defineService()

export function registerAuth(application: Application): void {
  const auth = new AuthService()
  const unsubscribe = auth.subscribe((state) => {
    const window = application.window.get()
    if (window.isDestroyed()) return
    window.webContents.send('auth:changed', state)
    if (state.status === 'authenticated') {
      if (window.isMinimized()) window.restore()
      window.show()
      window.setAlwaysOnTop(true)
      window.moveTop()
      window.focus()
      window.setAlwaysOnTop(false)
    }
  })

  ipcMain.handle('auth:state', () => auth.getState())
  ipcMain.handle('auth:login', () => auth.login())
  ipcMain.handle('auth:logout', () => auth.logout())
  application.registry.register(authToken, {
    dispose: () => {
      unsubscribe()
      ipcMain.removeHandler('auth:state')
      ipcMain.removeHandler('auth:login')
      ipcMain.removeHandler('auth:logout')
    }
  })
  void auth.restore()
}
