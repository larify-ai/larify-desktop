import { isLoopFinished, type ToolSet } from 'ai'
import { createModelRuntime } from '../model'
import { defaultModelConfig, isAgentModelConfig, type AgentModelConfig } from '../model/config'
import type { AgentOptions } from './engine'
import { buildSystemPrompt } from './prompt'
import template from './prompt.md?raw'

export interface AgentRuntimeInput {
  sessionId: string
  cwd: string
  modelConfig?: AgentModelConfig
  tools?: ToolSet
  stopWhen?: AgentOptions['stopWhen']
}

export function toolsContextFor<T>(tools: ToolSet, context: T): Record<string, T> {
  return Object.fromEntries(Object.keys(tools).map((name) => [name, context]))
}

export function createAgentRuntime(input: AgentRuntimeInput): AgentOptions {
  const config = isAgentModelConfig(input.modelConfig) ? input.modelConfig : defaultModelConfig
  const tools = input.tools ?? {}
  return {
    ...createModelRuntime(config),
    system: buildSystemPrompt(template, input.cwd),
    tools,
    activeTools: Object.keys(tools),
    toolsContext: toolsContextFor(tools, { sessionId: input.sessionId, cwd: input.cwd }),
    stopWhen: input.stopWhen ?? isLoopFinished()
  }
}
