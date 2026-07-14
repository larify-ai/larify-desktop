import {
  streamText,
  isLoopFinished,
  toUIMessageStream,
  createUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessageChunk,
  type UIMessageStreamWriter,
  type ToolCallRepairFunction,
} from "ai"
import { createModel, deepseekProviderOptions } from "./model"

export function runAgent(opts: {
  messages: ModelMessage[]
  buildTools: (writer: UIMessageStreamWriter) => ToolSet
  model?: LanguageModel
  abortSignal?: AbortSignal
  system?: string
  repairToolCall?: ToolCallRepairFunction<ToolSet>
}): ReadableStream<UIMessageChunk> {
  const { messages, buildTools, model = createModel(), abortSignal, system, repairToolCall } = opts
  return createUIMessageStream({
    execute: ({ writer }) => {
      const tools = buildTools(writer)
      const result = streamText({
        model,
        system,
        messages,
        tools,
        providerOptions: {
          deepseek: deepseekProviderOptions,
        },
        stopWhen: isLoopFinished(),
        abortSignal,
        repairToolCall,
      })
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          tools,
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
