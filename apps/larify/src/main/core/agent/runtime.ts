import type { DeepSeekLanguageModelOptions } from '@ai-sdk/deepseek'
import type { Tool, ToolSet } from 'ai'
import type { AgentModelConfig } from '../../../extensions/agent/shared/model'
import type { ToolContext } from '../../../shared/extension/tool'
import type { Toolkit } from '../../../shared/toolkit'
import type { App } from '../../../shared/types'
import { addLegacyToolkits, type ExtensionHost } from '../extension'
import { toolName, wrapTool } from '../extension/tool'
import { createModel } from '../model'
import { toolsContextFor } from './index'
import { discoverSkills } from './skills'
import { buildSystemPrompt } from './system-prompt'

export interface AgentRuntime {
  tools: ToolSet
  activeTools: string[]
  toolsContext: Record<string, ToolContext>
  system: string
  model: ReturnType<typeof createModel>
  deepseekOptions: DeepSeekLanguageModelOptions
}

async function prepareHost(app: App): Promise<ExtensionHost> {
  const host = app.get<ExtensionHost>('service', 'extension-host')
  if (!host) throw new Error('Extension host is unavailable.')
  await addLegacyToolkits(host, app.getAll<Toolkit>('tool'))

  if (host.has('skills')) await host.deactivate('skills')
  const skills = discoverSkills()
  await host.activate({
    name: 'skills',
    description: 'Agent skills',
    activate(extension) {
      for (const skill of skills) {
        extension.registerSkill(skill.name, {
          path: skill.path,
          description: skill.description,
          metadata: { eager: skill.eager }
        })
      }
    }
  })
  return host
}

export async function createAgentRuntime(input: {
  app: App
  cwd: string
  sessionId: string
  modelConfig: AgentModelConfig
  template: string
  metaTools: Record<string, Tool>
  prompt?: string
}): Promise<AgentRuntime> {
  const host = await prepareHost(input.app)
  const tools = new Map(host.getTools())
  for (const [name, tool] of Object.entries(input.metaTools)) {
    tools.set(toolName('agent', name), wrapTool(tool))
  }
  const toolSet = Object.fromEntries(tools)

  return {
    tools: toolSet,
    activeTools: [...tools]
      .filter(([, tool]) => tool.metadata?.eager === true)
      .map(([name]) => name),
    toolsContext: toolsContextFor(toolSet, { sessionId: input.sessionId, cwd: input.cwd }),
    system: buildSystemPrompt(input.template, host, input.cwd, input.prompt),
    model: createModel(input.modelConfig.modelId),
    deepseekOptions: { thinking: { type: input.modelConfig.thinking } }
  }
}
