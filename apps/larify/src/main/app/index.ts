import type { App } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { Registry } from '@shared/infra/registry'
import { installShutdown } from './shutdown'
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

async function createApplication(electron: App): Promise<Application> {
  // 调大 AI SDK 底层 globalThis.fetch 的连接池 keep-alive，并用普通 Agent 强制直连
  // （覆盖 Node 默认读 env 代理的行为；实测直连香港服务器比走代理更快）。
  // 必须在首次模型请求前配置，故放在 createApplication 最早期。
  configureUndiciPool()
  const registry = new Registry()
  const window = openMainWindow(electron)
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
  const application = await createApplication(electron)
  installShutdown(electron, () => application.registry.disposeAll())
}
