import type { App, BrowserWindow } from 'electron'

/**
 * 单实例锁：避免同一 userData 上并存多个实例。
 *
 * 为什么必须有：Chromium 的 LocalStorage 是「每个 userData 目录单写者」——已有实例占着
 * 该目录时，后启动的实例会**放弃加载持久化存储** ⇒ 它的 `localStorage` 读出来**完全为空**
 * ⇒ 表现为「设置里的 API Key / Memory Storage 都没了」（数据其实仍在旧实例与磁盘上）。
 *
 * @param getCurrentWindow 惰性取主窗口（可能在启动窗口期尚未创建）。
 * @returns true ⇒ 本进程继续启动；false ⇒ 已有实例存在，已退出。
 */
export function acquireSingleInstanceLock(
  app: App,
  getCurrentWindow: () => BrowserWindow | undefined
): boolean {
  if (app.requestSingleInstanceLock()) {
    app.on('second-instance', () => focusWindow(getCurrentWindow()))
    return true
  }
  app.quit()
  return false
}

/** 还原并聚焦窗口；未创建（启动窗口期）或已销毁 ⇒ 静默忽略。 */
function focusWindow(window: BrowserWindow | undefined): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
