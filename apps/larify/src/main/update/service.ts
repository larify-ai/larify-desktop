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

// 不维护完整状态机：下载由用户点「检查更新」触发，安装由用户点「重启并安装」触发
// （进度条与重启弹窗见 account-menu.tsx）；这里只记忆"已下载完成的版本"用于 renderer
// 挂载时兜底提示。
let autoUpdaterInstance: AppUpdater | undefined
let downloadedVersion: string | null = null

function getAutoUpdater(): AppUpdater {
  autoUpdaterInstance ??= (() => {
    const updater = electronUpdater.autoUpdater
    // 关掉 electron-updater 的两个默认静默行为，把「下载」与「安装」都交回用户点按：
    // ① autoDownload=true（默认）⇒ 一启动就后台静默下载；
    // ② autoInstallOnAppQuit=true（默认）⇒ 关 app 时静默拉起 NSIS 安装器覆盖安装目录。
    // ② 是崩溃根因：若关 app 时任务/终端仍在跑（node worker / pty shell / git / rg 占着
    // 安装目录里的文件），NSIS 的整体覆盖会半途而废 ⇒ 新 app.asar + 残缺 app.asar.unpacked
    // ⇒ 下次启动 require 到缺失的 unpacked .js 直接崩。故安装只由用户点「重启并安装」触发。
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
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
    if (!result?.isUpdateAvailable) return { status: 'current' }
    // autoDownload=false ⇒ 检查不会自动下载；用户点「检查更新」即视为同意下载，
    // 在这里补上（进度经 update:progress 回传；完成后弹「重启并安装」由用户点按）。
    void updater.downloadUpdate().catch((error) => console.error('[update]', error))
    return { status: 'available', version: result.updateInfo.version }
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

  // 启动时静默「只检查」更新（autoDownload=false ⇒ 不下载、不安装）；是否下载由用户点按决定。
  void checkForUpdates(application.electron.isPackaged).catch((error) =>
    console.error('[update]', error)
  )
}
