import {
  streamText,
  isLoopFinished,
  smoothStream,
  toUIMessageStream,
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessageChunk,
} from "ai"
import type { ToolContext } from "../../../shared/tool"
import { createModel, deepseekProviderOptions } from "./model"

export function runAgent(opts: {
  messages: ModelMessage[]
  tools: ToolSet
  activeTools?: string[]
  toolContext: ToolContext
  model?: LanguageModel
  abortSignal?: AbortSignal
  system?: string
}): ReadableStream<UIMessageChunk> {
  const { messages, tools, activeTools, toolContext, model = createModel(), abortSignal, system } = opts
  return createUIMessageStream({
    execute: ({ writer }) => {
      const result = streamText({
        model,
        system,
        messages,
        tools,
        activeTools,
        toolsContext: toolContext as never,
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
