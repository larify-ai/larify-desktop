import type { Registry } from '@shared/infra/registry'
import terminalPlugin from '../../../../extensions/terminal/renderer'
import browserPlugin from '../../../../extensions/browser/renderer'
import { RendererPluginHost, rendererPluginHostToken } from './renderer-plugins'
import { WorkbenchRendererRegistry, workbenchRendererRegistryToken } from './workbench-renderers'

export function registerBuiltinRenderers(registry: Registry): void {
  const workbenchRenderers = new WorkbenchRendererRegistry(registry)
  registry.register(workbenchRendererRegistryToken, workbenchRenderers)
  const host = new RendererPluginHost(registry)
  registry.register(rendererPluginHostToken, host)
  host.activate(terminalPlugin)
  host.activate(browserPlugin)
}
