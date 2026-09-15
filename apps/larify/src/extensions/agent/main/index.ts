import type { Plugin } from '../../../main/core/plugin/protocol'
import type { PluginHost } from '../../../main/core/plugin/host'
import { pluginHostToken } from '../../../main/core/plugin/service'
import { createPluginTools } from './plugin-tools'
import { askUserTool } from './ask-user'
import { createSearchMemoryTool } from './search-memory'
import { resetContextTool } from './reset-context'
import { scheduleTaskTool } from './schedule-task'
import { showProgressTool } from './show-progress'

const plugin: Plugin = {
  manifest: {
    id: 'agent',
    description: 'List plugins, list tools, list skills, read schemas, search memory, ask user, show progress, reset context, and schedule tasks.'
  },
  activate(context) {
    const host = context.registry.get<PluginHost>(pluginHostToken)
    if (!host) throw new Error('PluginHost is unavailable.')

    for (const [name, tool] of Object.entries(createPluginTools(host))) {
      context.registerTool(name, tool)
    }
    context.registerTool('ask_user', askUserTool)
    context.registerTool('search_memory', createSearchMemoryTool(context.registry))
    context.registerTool('reset_context', resetContextTool)
    context.registerTool('schedule_task', scheduleTaskTool)
    context.registerTool('show_progress', showProgressTool)
  }
}

export default plugin
