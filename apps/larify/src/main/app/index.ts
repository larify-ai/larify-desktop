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
import { openMainWindow, registerWindow } from '../window'
import type { Application } from './application'

async function createApplication(electron: App): Promise<Application> {
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
  return application
}

export async function bootstrap(electron: App): Promise<void> {
  electronApp.setAppUserModelId('ai.larify.desktop')
  const application = await createApplication(electron)
  installShutdown(electron, () => application.registry.disposeAll())
}
