import type { Toolkit } from '../../../shared/toolkit'
import type { ExtensionHost } from './host'

export async function addLegacyToolkits(host: ExtensionHost, toolkits: Toolkit[]): Promise<void> {
  for (const toolkit of toolkits) {
    if (host.has(toolkit.name)) continue
    await host.activate({
      name: toolkit.name,
      description: toolkit.description ?? toolkit.name,
      activate(app) {
        for (const [name, tool] of Object.entries(toolkit.tools)) app.registerTool(name, tool)
      }
    })
  }
}
