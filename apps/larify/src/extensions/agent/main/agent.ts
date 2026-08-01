import {
  streamText,
  isLoopFinished,
  smoothStream,
  toUIMessageStream,
  createUIMessageStream,
  wrapLanguageModel,
  type LanguageModelMiddleware,
  type ModelMessage,
  type PrepareStepFunction,
  type ToolSet,
  type UIMessageChunk
} from 'ai'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { DeepSeekLanguageModelOptions } from '@ai-sdk/deepseek'
import type { ToolContext } from '../../../shared/tool'
import { createModel } from './model'

type AgentOutput = NonNullable<Parameters<typeof streamText>[0]['output']>

export function toolsContextFor(tools: ToolSet, context: ToolContext): Record<string, ToolContext> {
  return Object.fromEntries(Object.keys(tools).map((name) => [name, context]))
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

export function runAgent<OUTPUT extends AgentOutput = AgentOutput>(opts: {
  messages: ModelMessage[]
  tools: ToolSet
  activeTools: string[]
  toolsContext: Record<string, ToolContext>
  output?: OUTPUT
  model?: LanguageModelV4
  abortSignal?: AbortSignal
  system?: string
  deepseekOptions?: DeepSeekLanguageModelOptions
  prepareStep?: PrepareStepFunction<ToolSet, Record<string, never>>
}): ReturnType<typeof streamText<ToolSet, Record<string, never>, OUTPUT>> {
  const {
    messages,
    tools,
    activeTools,
    toolsContext,
    abortSignal,
    system,
    output,
    deepseekOptions,
    prepareStep
  } = opts
  const model = wrapLanguageModel({
    model: opts.model ?? createModel(),
    middleware: promptWithTools(activeTools)
  })
  return streamText({
    model,
    system,
    messages,
    tools,
    toolsContext: toolsContext as never,
    output,
    providerOptions: deepseekOptions ? { deepseek: deepseekOptions } : undefined,
    experimental_transform: smoothStream({
      delayInMs: 20,
      chunking: new Intl.Segmenter('zh', { granularity: 'word' })
    }),
    stopWhen: isLoopFinished(),
    prepareStep,
    abortSignal
  })
}

export function runAgentUIStream(
  opts: Parameters<typeof runAgent>[0]
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    execute: ({ writer }) => {
      const result = runAgent(opts)
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          onError: (e) => {
            console.error('[agent tool error]', e)
            return e instanceof Error ? e.message : String(e)
          }
        })
      )
    },
    onError: (e) => {
      console.error('[agent stream error]', e)
      return e instanceof Error ? e.message : String(e)
    }
  })
}
