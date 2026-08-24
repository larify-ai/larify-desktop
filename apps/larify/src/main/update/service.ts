import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { Application } from '../app/application'

export const UPDATE_FEED_URL =
  'https://cnb.cool/larify-ai/larify-desktop/-/releases/latest/download'

export interface UpdateChecker {
  checkForUpdates(): Promise<unknown>
}

function getAutoUpdater(): AppUpdater {
  const updater = electronUpdater.autoUpdater
  updater.setFeedURL({
    provider: 'generic',
    url: UPDATE_FEED_URL
  })
  return updater
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
