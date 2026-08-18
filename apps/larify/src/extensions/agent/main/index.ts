import type { Plugin } from '../../../main/core/plugin/protocol'
import type { PluginHost } from '../../../main/core/plugin/host'
import { pluginHostToken } from '../../../main/core/plugin/service'
import { createPluginTools } from './plugin-tools'
import { askUserTool } from './ask-user'
import { createSearchMemoryTool } from './search-memory'

const plugin: Plugin = {
  manifest: {
    id: 'agent',
    description: 'List plugins, list tools, list skills, read schemas, ask user, and search memory.'
  },
  activate(context) {
    const host = context.registry.get<PluginHost>(pluginHostToken)
    if (!host) throw new Error('PluginHost is unavailable.')

    for (const [name, tool] of Object.entries(createPluginTools(host))) {
      context.registerTool(name, tool)
    }
    context.registerTool('ask_user', askUserTool)
    context.registerTool('search_memory', createSearchMemoryTool(context.registry))
  }
}

export default plugin
