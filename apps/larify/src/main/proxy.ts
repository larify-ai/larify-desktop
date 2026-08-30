import { session, type Session } from 'electron'
import { BROWSER_PARTITION } from '../extensions/browser/shared/types'

// Electron 文档明确：mode:'system' 与"不设置代理配置"不同——
// 不设置时，Electron 仅在**没有命令行选项影响代理**时才回退到系统设置；
// 显式 system 模式则确定性使用操作系统代理（用户浏览器走什么，应用就走什么）。
// 用户电脑配置了系统代理（公司代理/Clash 等）时，应用内的：
// - 默认会话（窗口加载、fetch）
// - 浏览器插件分区 persist:larify-browser（web_fetch / 页面打开）
// 都应跟随系统代理，否则裸连可能导致慢/超时（如境外文档站）。
// 未配置系统代理时 system 模式自动等效直连，无副作用。
export async function configureSystemProxy(): Promise<void> {
  const targets: Array<{ name: string; session: Session }> = [
    { name: 'defaultSession', session: session.defaultSession },
    { name: BROWSER_PARTITION, session: session.fromPartition(BROWSER_PARTITION) }
  ]
  for (const { name, session: target } of targets) {
    try {
      await target.setProxy({ mode: 'system' })
      console.log(`[proxy] ${name} -> system mode`)
    } catch (error) {
      console.warn(`[proxy] failed to set system proxy for ${name}:`, error)
    }
  }
}


