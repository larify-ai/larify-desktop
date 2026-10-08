import type { App } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { Registry } from '@shared/infra/registry'
import { installShutdown } from './shutdown'
import { acquireSingleInstanceLock } from './single-instance'
import { registerSession } from '../core/session/open'
import { registerAgent } from '../core/agent'
import { registerAttachment } from '../core/attachment'
import { registerGit } from '../core/git'
import { registerResourceManager } from '../core/resource'
import { registerPlugin } from '../core/plugin'
import { registerTheme } from '../theme'
import { registerDialog } from '../dialog'
import { registerUpdate } from '../update'
import { registerAuth } from '../auth'
import { registerModelApi } from '../model-api'
import { openMainWindow, registerWindow } from '../window'
import { configureUndiciPool } from '../core/net/undici-pool'
import type { Application } from './application'

async function createApplication(
  electron: App,
  window: Application['window']
): Promise<Application> {
  // 调大 AI SDK 底层 globalThis.fetch 的连接池 keep-alive，并用普通 Agent 强制直连
  // （覆盖 Node 默认读 env 代理的行为；实测直连香港服务器比走代理更快）。
  // 必须在首次模型请求前配置，故放在 createApplication 最早期。
  configureUndiciPool()
  const registry = new Registry()
  const application: Application = {
    electron,
    window,
    registry
  }
  registerWindow(application)
  registerTheme(application)
  registerDialog(application)
  registerSession(application)
  registerGit(application)
  registerResourceManager(application)
  registerAttachment(application)
  await registerPlugin(application)
  registerAgent(application)
  registerUpdate(application)
  registerAuth(application)
  await registerModelApi()
  return application
}

export async function bootstrap(electron: App): Promise<void> {
  electronApp.setAppUserModelId('ai.larify.desktop')
  // 先拿锁再建窗：后启动的实例若已被占用，立即退出、绝不建窗（否则会闪出一个
  // 「localStorage 为空」的空窗口——本缺陷的用户可见来源）。聚焦回调惰性取窗口：
  // second-instance 可能在建窗前到达 ⇒ 静默忽略（本实例稍后仍会显示自己的窗口）。
  const holder: { window?: Application['window'] } = {}
  if (!acquireSingleInstanceLock(electron, () => holder.window?.get())) return
  const window = openMainWindow(electron)
  holder.window = window
  const application = await createApplication(electron, window)
  installShutdown(electron, () => application.registry.disposeAll())
}
