import { defineService } from '@shared/infra/registry'
import type { Application } from '../../app/application'
import { registerResourceIpc } from './ipc'
import { ResourceManager } from './manager'

export const resourceManagerToken = defineService()
const resourceIpcToken = defineService()

export function registerResourceManager(application: Application): void {
  const manager = new ResourceManager()
  const ipc = registerResourceIpc(manager, application.window.get())
  application.registry.register(resourceManagerToken, manager)
  application.registry.register(resourceIpcToken, { dispose: ipc })
}
