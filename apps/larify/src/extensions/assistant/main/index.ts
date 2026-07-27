import { ipcMain } from 'electron'
import type { Extension } from 'kernel'
import { GitSnapshotService } from './git-snapshot'

const extension: Extension = {
  activate(_app, context) {
    const snapshots = new GitSnapshotService()
    const active = new Map<string, Awaited<ReturnType<GitSnapshotService['start']>>>()

    ipcMain.handle('review:begin', async (_event, runId: string, cwd: string) => {
      active.set(runId, await snapshots.start(cwd))
    })

    ipcMain.handle('review:finish', async (_event, runId: string) => {
      const start = active.get(runId) ?? null
      active.delete(runId)
      return snapshots.finish(start)
    })

    context.subscriptions.push({
      dispose: () => {
        active.clear()
        ipcMain.removeHandler('review:begin')
        ipcMain.removeHandler('review:finish')
      }
    })
  }
}

export default extension
