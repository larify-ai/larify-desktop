import { ipcMain } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { Application } from '../app/application'

export const UPDATE_FEED_URL =
  'https://cnb.cool/larify-ai/larify-desktop/-/releases/latest/download'

// checkForUpdatesAndNotify 下载完成后弹系统通知；默认文案是英文，这里自定义为中文。
// title/body 支持 {appName} 与 {version} 占位符。
const DOWNLOAD_NOTIFICATION = {
  title: '新版本已准备好安装',
  body: '{appName} 新版本 {version} 已下载，退出应用时会自动安装'
}

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
      url: UPDATE_FEED_URL,
      // cnb.cool 的 CDN（asset.cnb.cool）不支持 Range 请求（实测返回 200 全量而非 206），
      // 差量更新必然失败并回退全量；直接禁用可跳过注定失败的差量尝试。
      useMultipleRangeRequest: false
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
  // 启动时静默检查更新；若发现并下载完成，由 checkForUpdatesAndNotify 弹中文系统通知。
  void checkForUpdatesAndNotify(application.electron.isPackaged).catch((error) =>
    console.error('[update]', error)
  )
  ipcMain.handle('update:check', async (): Promise<UpdateCheckResponse> => {
    if (!application.electron.isPackaged) return { status: 'development' }

    const result = (await checkForUpdatesAndNotify(true)) as
      | { updateInfo?: { version?: string } }
      | null
    const version = result?.updateInfo?.version
    return version && version !== application.electron.getVersion()
      ? { status: 'available', version }
      : { status: 'current', version }
  })
}

// 检查更新；下载完成后自动弹中文系统通知，提示用户新版本已就绪（官方最佳实践）。
async function checkForUpdatesAndNotify(isPackaged: boolean): Promise<unknown> {
  if (!isPackaged) return null
  return getAutoUpdater().checkForUpdatesAndNotify(DOWNLOAD_NOTIFICATION)
}
