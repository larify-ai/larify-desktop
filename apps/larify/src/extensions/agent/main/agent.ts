import {
  streamText,
  isLoopFinished,
  smoothStream,
  toUIMessageStream,
  createUIMessageStream,
  wrapLanguageModel,
  type LanguageModelMiddleware,
  type ModelMessage,
  type ToolSet,
  type UIMessageChunk,
} from "ai"
import type { LanguageModelV4 } from "@ai-sdk/provider"
import type { ToolContext } from "../../../shared/tool"
import { createModel, deepseekProviderOptions } from "./model"

export function toolsContextFor(
  tools: ToolSet,
  context: ToolContext,
): Record<string, ToolContext> {
  return Object.fromEntries(Object.keys(tools).map((name) => [name, context]))
}

function promptWithTools(names: string[]): LanguageModelMiddleware {
  const keep = new Set(names)
  return {
    transformParams: async ({ params }) => ({
      ...params,
      tools: params.tools?.filter((tool) => keep.has(tool.name)),
    }),
  }
}

export function runAgent(opts: {
  messages: ModelMessage[]
  tools: ToolSet
  activeTools: string[]
  toolsContext: Record<string, ToolContext>
  model?: LanguageModelV4
  abortSignal?: AbortSignal
  system?: string
}): ReadableStream<UIMessageChunk> {
  const { messages, tools, activeTools, toolsContext, abortSignal, system } = opts
  const model = wrapLanguageModel({
    model: opts.model ?? createModel(),
    middleware: promptWithTools(activeTools),
  })
  return createUIMessageStream({
    execute: ({ writer }) => {
      const result = streamText({
        model,
        system,
        messages,
        tools,
        toolsContext: toolsContext as never,
        providerOptions: {
          deepseek: deepseekProviderOptions,
        },
        experimental_transform: smoothStream({
          delayInMs: 20,
          chunking: new Intl.Segmenter("zh", { granularity: "word" }),
        }),
        stopWhen: isLoopFinished(),
        abortSignal,
      })
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          onError: (e) => {
            console.error("[agent tool error]", e)
            return e instanceof Error ? e.message : String(e)
          },
        }),
      )
    },
    onError: (e) => {
      console.error("[agent stream error]", e)
      return e instanceof Error ? e.message : String(e)
    },
  })
}
