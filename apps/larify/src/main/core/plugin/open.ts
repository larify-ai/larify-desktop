import type { Application } from '../../app/application'
import { PluginHost } from './host'
import { discoverBuiltinPlugins, loadPlugins } from './loader'
import { pluginHostToken } from './service'

export async function registerPlugin(application: Application): Promise<void> {
  const host = new PluginHost(application.registry)
  application.registry.register(pluginHostToken, host)
  await loadPlugins(host, discoverBuiltinPlugins())
}
