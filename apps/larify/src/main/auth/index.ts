import { ipcMain } from 'electron'
import { defineService } from '@shared/infra/registry'

import type { Application } from '../app/application'
import { getModelApiService } from '../model-api/service'
import { getAuthService } from './service'

const authToken = defineService()

export function registerAuth(application: Application): void {
  const auth = getAuthService()
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
  ipcMain.handle('auth:logout', async () => {
    try {
      await auth.logout()
    } finally {
      // Drop the cached model-api credentials so a different account cannot
      // reuse them, even when local logout partially fails.
      await getModelApiService().clear()
    }
  })
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
