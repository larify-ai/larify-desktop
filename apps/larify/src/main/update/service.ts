import { ipcMain } from 'electron'
import electronUpdater, { type AppUpdater, type ProgressInfo } from 'electron-updater'
import { defineService } from '@shared/infra/registry'
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

// 不维护完整状态机：下载完成提示由 renderer 用对话框展示（见 account-menu.tsx），
// 这里只记忆"已下载完成的版本"用于 renderer 挂载时兜底提示。
let autoUpdaterInstance: AppUpdater | undefined
let downloadedVersion: string | null = null

function getAutoUpdater(): AppUpdater {
  autoUpdaterInstance ??= (() => {
    const updater = electronUpdater.autoUpdater
    // cnb.cool 的 CDN（asset.cnb.cool）不支持 Range 请求（实测返回 200 全量而非 206）。
    // 差量下载基于 blockmap + Range，必然失败并回退全量——这会先走一段差量进度、
    // 再重置回全量重新下载，导致进度条"回退"。
    // 故彻底禁用差量（disableDifferentialDownload 是 AppUpdater 实例属性）直接全量下载，
    // 进度从 0 单调递增不回退。
    updater.disableDifferentialDownload = true
    updater.setFeedURL({
      provider: 'generic',
      url: UPDATE_FEED_URL,
      // 禁用 range 请求，避免差量内部的 range 尝试。
      useMultipleRangeRequest: false
    })
    return updater
  })()
  return autoUpdaterInstance
}

export async function checkForUpdates(isPackaged: boolean, updater?: UpdateChecker): Promise<void> {
  if (!isPackaged) return
  await (updater ?? getAutoUpdater()).checkForUpdates()
}

const updateServiceToken = defineService()

export function registerUpdate(application: Application): void {
  const updater = getAutoUpdater()

  const broadcast = (channel: string, payload?: unknown): void => {
    const win = application.window.get()
    if (win.isDestroyed()) return
    win.webContents.send(channel, payload)
  }

  // 务必先注册监听器再触发 checkForUpdates()，否则 electron-updater 不会下发
  // download-progress（源码：listenerCount(DOWNLOAD_PROGRESS)>0 时才挂 onProgress）。
  const onProgress = (progress: ProgressInfo): void => {
    broadcast('update:progress', progress)
  }
  const onDownloaded = (event: { version?: string }): void => {
    downloadedVersion = event.version ?? null
    broadcast('update:ready', event.version)
  }
  const onError = (error: Error): void => {
    broadcast('update:error', error.message)
  }

  updater.on('download-progress', onProgress)
  updater.on('update-downloaded', onDownloaded)
  updater.on('error', onError)

  ipcMain.handle('update:check', async (): Promise<UpdateCheckResponse> => {
    if (!application.electron.isPackaged) return { status: 'development' }
    // checkForUpdates() resolve 时已同步确定是否有更新（update-available /
    // update-not-available 均同步 emit），用其返回值判断，避免读异步状态出错。
    const result = await updater.checkForUpdates()
    return result?.isUpdateAvailable
      ? { status: 'available', version: result.updateInfo.version }
      : { status: 'current' }
  })

  ipcMain.handle('update:install', (): void => {
    // quitAndInstall 只在 update-downloaded 之后调用才生效。
    updater.quitAndInstall()
  })

  // renderer 挂载时查询，兜底提示启动静默检查已下载完成的更新。
  ipcMain.handle('update:downloadedVersion', (): string | null => downloadedVersion)

  application.registry.register(updateServiceToken, {
    dispose: () => {
      updater.removeListener('download-progress', onProgress)
      updater.removeListener('update-downloaded', onDownloaded)
      updater.removeListener('error', onError)
      ipcMain.removeHandler('update:check')
      ipcMain.removeHandler('update:install')
      ipcMain.removeHandler('update:downloadedVersion')
    }
  })

  // 启动时静默检查更新；发现则自动下载，完成后由 renderer 弹"重启并安装"。
  void checkForUpdates(application.electron.isPackaged).catch((error) =>
    console.error('[update]', error)
  )
}
