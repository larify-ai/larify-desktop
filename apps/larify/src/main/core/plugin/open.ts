import type { Application } from '../../app/application'
import { PluginHost } from './host'
import { discoverBuiltinPlugins, loadPlugins } from './loader'
import { pluginHostToken } from './service'
import { FilesystemSkillDiscovery } from './skill-discovery'

export async function registerPlugin(application: Application): Promise<void> {
  const host = new PluginHost(application.registry, new FilesystemSkillDiscovery())
  application.registry.register(pluginHostToken, host)
  await loadPlugins(host, discoverBuiltinPlugins())
}
