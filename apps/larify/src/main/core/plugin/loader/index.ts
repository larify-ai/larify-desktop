import type { Plugin } from '../protocol'
import type { PluginHost } from '../host'

export { discoverBuiltinPlugins } from './builtin'

export async function loadPlugins(host: PluginHost, plugins: Plugin[]): Promise<void> {
  for (const plugin of plugins) {
    try {
      await host.activate(plugin)
    } catch (error) {
      console.error(`[plugin] Failed to load "${plugin.manifest.id}":`, error)
    }
  }
}
