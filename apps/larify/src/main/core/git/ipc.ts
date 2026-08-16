import { ipcMain } from 'electron'
import { defineService } from '@shared/infra/registry'
import type { Application } from '../../app/application'
import { status } from './status'

const gitIpcToken = defineService()

export function registerGit(application: Application): void {
  ipcMain.handle('git:status', async (_event, root: string) => {
    try {
      return await status(root)
    } catch {
      return []
    }
  })
  application.registry.register(gitIpcToken, {
    dispose: () => ipcMain.removeHandler('git:status')
  })
}
