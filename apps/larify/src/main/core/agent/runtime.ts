import { isLoopFinished, type ToolSet } from 'ai'
import type { PluginHost } from '../plugin/host'
import { createModelRuntime } from '../model'
import {
  defaultModelConfig,
  imageCapableModelIds,
  isAgentModelConfig,
  modelContextWindows,
  type AgentModelConfig
} from '../model/config'
import type { AgentOptions } from './engine'
import { contextRollover } from './context-rollover'
import { buildSystemPrompt } from './prompt'
import template from './prompt.md?raw'

export interface AgentRuntimeInput {
  sessionId: string
  cwd: string
  modelConfig?: AgentModelConfig
  stopWhen?: AgentOptions['stopWhen']
}

export function toolsContextFor<T>(tools: ToolSet, context: T): Record<string, T> {
  return Object.fromEntries(Object.keys(tools).map((name) => [name, context]))
}

function collectTools(host: PluginHost): ToolSet {
  return Object.fromEntries(host.listPlugins().flatMap(({ id }) => [...(host.getTools(id) ?? [])]))
}

function collectPromptContext(host: PluginHost): {
  plugins: Array<{ name: string; description: string }>
  skills: Array<{ name: string; path: string; description: string }>
} {
  const plugins: Array<{ name: string; description: string }> = []
  const skills: Array<{ name: string; path: string; description: string }> = []
  for (const { id, description } of host.listPlugins()) {
    const tools = host.getTools(id) ?? new Map()
    const pluginSkills = host.getSkills(id) ?? new Map()
    const eager = [...tools.values(), ...pluginSkills.values()].some(
      ({ metadata }) => metadata?.eager === true
    )
    if (eager) {
      plugins.push({
        name: id,
        description: `${description ? `${description} ` : ''}(${tools.size} tools, ${pluginSkills.size} skills)`
      })
    }
    skills.push(
      ...[...pluginSkills]
        .filter(([, { metadata }]) => metadata?.eager === true)
        .map(([name, { path, description: skillDescription }]) => ({
          name,
          path,
          description: skillDescription
        }))
    )
  }
  return { plugins, skills }
}

export function createAgentRuntime(input: AgentRuntimeInput, host: PluginHost): AgentOptions {
  host.refreshSkills()
  const config = isAgentModelConfig(input.modelConfig) ? input.modelConfig : defaultModelConfig
  const tools = collectTools(host)
  return {
    ...createModelRuntime(config),
    system: buildSystemPrompt(template, input.cwd, collectPromptContext(host)),
    tools,
    imageCapable: imageCapableModelIds.has(config.modelId),
    activeTools: Object.entries(tools)
      .filter(([, tool]) => tool.metadata?.eager === true)
      .map(([name]) => name),
    toolsContext: toolsContextFor(tools, {
      sessionId: input.sessionId,
      cwd: input.cwd,
      modelId: config.modelId
    }),
    prepareStep: contextRollover(modelContextWindows[config.modelId].rollover),
    stopWhen: input.stopWhen ?? isLoopFinished()
  }
}
