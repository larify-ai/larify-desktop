import type { DeepSeekLanguageModelOptions } from '@ai-sdk/deepseek'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import {
  convertToModelMessages,
  createUIMessageStream,
  isLoopFinished,
  readUIMessageStream,
  smoothStream,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type LanguageModelMiddleware,
  type ModelMessage,
  type PrepareStepFunction,
  type StopCondition,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk
} from 'ai'
import type { ToolContext } from '../../../shared/extension/tool'
import { createModel } from '../model'

export type AgentOutput = NonNullable<Parameters<typeof streamText>[0]['output']>

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
  stopWhen?: StopCondition<ToolSet, Record<string, never>>
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
    prepareStep,
    stopWhen
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
    stopWhen: stopWhen ?? isLoopFinished(),
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
          onError: (error) => {
            console.error('[agent tool error]', error)
            return error instanceof Error ? error.message : String(error)
          }
        })
      )
    },
    onError: (error) => {
      console.error('[agent stream error]', error)
      return error instanceof Error ? error.message : String(error)
    }
  })
}

export interface AgentSessionResult<OUTPUT extends AgentOutput> {
  result: ReturnType<typeof runAgent<OUTPUT>>
  messages: Promise<UIMessage[]>
  latest: () => UIMessage[]
}

function appendResponse(messages: UIMessage[], response: UIMessage): UIMessage[] {
  return messages.at(-1)?.id === response.id
    ? [...messages.slice(0, -1), response]
    : [...messages, response]
}

export async function runAgentSession<OUTPUT extends AgentOutput = AgentOutput>(
  messages: UIMessage[],
  options: Omit<Parameters<typeof runAgent<OUTPUT>>[0], 'messages'>,
  onChunk?: (chunk: UIMessageChunk) => void
): Promise<AgentSessionResult<OUTPUT>> {
  const result = runAgent({
    ...options,
    messages: await convertToModelMessages(messages)
  })

  let latest = messages
  const stream = toUIMessageStream({
    stream: result.stream,
    originalMessages: messages,
    onError: (error) => (error instanceof Error ? error.message : String(error)),
    onEnd: ({ messages }) => {
      latest = messages
    }
  })
  const [updates, chunks] = stream.tee()
  const completed = Promise.all([
    (async () => {
      for await (const response of readUIMessageStream({ stream: updates })) {
        latest = appendResponse(messages, response)
      }
    })(),
    chunks.pipeTo(new WritableStream({ write: onChunk }))
  ]).then(() => latest)

  return { result, messages: completed, latest: () => latest }
}
