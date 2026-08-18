import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { Application } from '../app/application'

export interface UpdateChecker {
  checkForUpdates(): Promise<unknown>
}

function getAutoUpdater(): AppUpdater {
  return electronUpdater.autoUpdater
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
}
