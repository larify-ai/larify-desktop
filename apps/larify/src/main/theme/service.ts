import { defineService } from '../infra/registry'
import type { Application } from '../app/application'
import { registerThemeIpc } from './ipc'

export const themeToken = defineService()

export function registerTheme(application: Application): void {
  const dispose = registerThemeIpc(application)
  application.registry.register(themeToken, { dispose })
}
