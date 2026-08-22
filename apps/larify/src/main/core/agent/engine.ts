import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import {
  smoothStream,
  streamText,
  wrapLanguageModel,
  type AsyncIterableStream,
  type LanguageModelMiddleware,
  type ModelMessage,
  type PrepareStepFunction,
  type StopCondition,
  type TextStreamPart,
  type ToolSet
} from 'ai'
import { promoteToolImages } from './tool-images'

export interface AgentOptions {
  model: LanguageModelV4
  tools: ToolSet
  activeTools: string[]
  toolsContext: Record<string, unknown>
  imageCapable: boolean
  abortSignal?: AbortSignal
  system?: string
  providerOptions?: ProviderOptions
  prepareStep?: PrepareStepFunction<ToolSet, Record<string, never>>
  stopWhen?: StopCondition<ToolSet, Record<string, never>>
}

function promptWithTools(names: string[]): LanguageModelMiddleware {
  const keep = new Set(names)
  return {
    transformParams: async ({ params }) => ({
      ...params,
      tools: params.tools?.filter((tool) => keep.has(tool.name))
    })
  }
}

function toolImages(imageCapable: boolean): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => ({
      ...params,
      prompt: promoteToolImages(params.prompt, imageCapable)
    })
  }
}

export function runAgent(
  messages: ModelMessage[],
  options: AgentOptions
): AsyncIterableStream<TextStreamPart<ToolSet>> {
  const { activeTools, imageCapable, model, toolsContext, ...streamOptions } = options
  const wrappedModel = wrapLanguageModel({
    model,
    middleware: [toolImages(imageCapable), promptWithTools(activeTools)]
  })
  return streamText({
    ...streamOptions,
    model: wrappedModel,
    messages,
    toolsContext: toolsContext as never,
    experimental_transform: smoothStream({
      delayInMs: 20,
      chunking: new Intl.Segmenter('zh', { granularity: 'word' })
    })
  }).stream
}
