import type { App } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { Registry } from '../infra/registry'
import { installShutdown } from './shutdown'
import { registerSession } from '../core/session/open'
import { registerAgent } from '../core/agent'
import { registerAttachment } from '../core/attachment'
import { registerPlugin } from '../core/plugin'
import { registerTheme } from '../theme'
import { registerDialog } from '../dialog'
import { openMainWindow, registerWindow } from '../window'
import type { Application } from './application'

function createApplication(electron: App): Application {
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
  registerAttachment(application)
  registerPlugin(application)
  registerAgent(application)
  return application
}

export function bootstrap(electron: App): void {
  electronApp.setAppUserModelId('ai.larify.app')
  const application = createApplication(electron)
  installShutdown(electron, () => application.registry.disposeAll())
}
