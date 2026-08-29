import { ipcMain } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { Application } from '../app/application'

export const UPDATE_FEED_URL =
  'https://cnb.cool/larify-ai/larify-desktop/-/releases/latest/download'

export interface UpdateChecker {
  checkForUpdates(): Promise<unknown>
}

interface UpdateCheckResponse {
  status: 'current' | 'available' | 'development'
  version?: string
}

let autoUpdaterInstance: AppUpdater | undefined

function getAutoUpdater(): AppUpdater {
  autoUpdaterInstance ??= (() => {
    const updater = electronUpdater.autoUpdater
    updater.setFeedURL({
      provider: 'generic',
      url: UPDATE_FEED_URL
    })
    return updater
  })()
  return autoUpdaterInstance
}

export async function checkForUpdates(
  isPackaged: boolean,
  updater?: UpdateChecker
): Promise<void> {
  if (!isPackaged) return
  await (updater ?? getAutoUpdater()).checkForUpdates()
}

export function registerUpdate(application: Application): void {
  void checkForUpdates(application.electron.isPackaged).catch((error) =>
    console.error('[update]', error)
  )
  ipcMain.handle('update:check', async (): Promise<UpdateCheckResponse> => {
    if (!application.electron.isPackaged) return { status: 'development' }

    const result = (await getAutoUpdater().checkForUpdates()) as
      | { updateInfo?: { version?: string } }
      | null
    const version = result?.updateInfo?.version
    return version && version !== application.electron.getVersion()
      ? { status: 'available', version }
      : { status: 'current', version }
  })
}
