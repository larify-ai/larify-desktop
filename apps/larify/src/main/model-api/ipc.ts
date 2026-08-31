import { ipcMain } from 'electron'

import type { ModelApiService } from './service'

export function registerModelApiIpc(service: ModelApiService): void {
  ipcMain.handle('model-api:get-credentials', () => {
    // 渲染进程只需要"触发拉取预热缓存"的效果；凭据数据（含 sk- key）
    // 只应在主进程内流转，不返回给渲染层。
    void service.getCredentials().catch(() => undefined)
  })
  ipcMain.handle('model-api:get-balance', () => service.getBalance())
}
