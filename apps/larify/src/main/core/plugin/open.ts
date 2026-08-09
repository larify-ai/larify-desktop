import type { Application } from '../../app/application'
import { defineService } from '../../infra/registry'
import { PluginHost } from './host'

export const pluginHostToken = defineService()

export function registerPlugin(application: Application): void {
  application.registry.register(pluginHostToken, new PluginHost(application.registry))
}
