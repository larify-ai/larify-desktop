import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { Application } from '../app/application'

export interface UpdateChecker {
  checkForUpdatesAndNotify(): Promise<unknown>
}

function getAutoUpdater(): AppUpdater {
  return electronUpdater.autoUpdater
}

export async function checkForUpdates(
  isPackaged: boolean,
  updater?: UpdateChecker
): Promise<void> {
  if (!isPackaged) return
  await (updater ?? getAutoUpdater()).checkForUpdatesAndNotify()
}

export function registerUpdate(application: Application): void {
  void checkForUpdates(application.electron.isPackaged).catch((error) =>
    console.error('[update]', error)
  )
}
