import {
  streamText,
  isLoopFinished,
  toUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessageChunk,
} from "ai"
import { createModel } from "./model"

export function runAgent(
  messages: ModelMessage[],
  tools?: ToolSet,
  model: LanguageModel = createModel(),
  abortSignal?: AbortSignal,
): ReadableStream<UIMessageChunk> {
  const result = streamText({
    model,
    messages,
    tools,
    stopWhen: isLoopFinished(),
    abortSignal,
  })
  return toUIMessageStream({
    stream: result.stream,
    tools,
    onError: (e) => {
      console.error("[agent stream error]", e)
      return String(e)
    },
  })
}
