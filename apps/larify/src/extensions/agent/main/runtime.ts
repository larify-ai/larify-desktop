import type { DeepSeekLanguageModelOptions } from '@ai-sdk/deepseek'
import type { ToolSet } from 'ai'
import type { App } from '@shared/extension'
import type { Toolkit, ToolContext } from '../../../shared/tool'
import type { AgentModelConfig } from '../shared/model'
import { createAgentToolkit, type ContextSearch } from './agent-toolkit'
import { toolsContextFor } from './agent'
import { createModel } from './model'
import { createToolRegistry } from './registry'
import { createSkillFactory, skillRoots } from './skill-factory'
import { buildSystemPrompt } from './system-prompt'

export interface AgentRuntime {
  tools: ToolSet
  activeTools: string[]
  toolsContext: Record<string, ToolContext>
  system: string
  model: ReturnType<typeof createModel>
  deepseekOptions: DeepSeekLanguageModelOptions
}

export function createAgentRuntime(input: {
  app: App
  cwd: string
  sessionId: string
  modelConfig: AgentModelConfig
  prompt?: string
}): AgentRuntime {
  const skills = createSkillFactory(skillRoots())
  const registry = createToolRegistry(input.app.getAll<Toolkit>('tool'))
  registry.addToolkit(
    createAgentToolkit(registry, skills, input.app.get<ContextSearch>('service', 'context'))
  )
  const tools = registry.toolSet()

  return {
    tools,
    activeTools: registry.activeToolNames(),
    toolsContext: toolsContextFor(tools, { sessionId: input.sessionId, cwd: input.cwd }),
    system: buildSystemPrompt(registry, input.cwd, skills, input.prompt),
    model: createModel(input.modelConfig.modelId),
    deepseekOptions: { thinking: { type: input.modelConfig.thinking } }
  }
}
