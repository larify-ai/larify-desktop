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
  type UIMessageStreamWriter,
} from "ai"
import { createModel, deepseekProviderOptions } from "./model"
import { shouldThrowToolFailures, ToolInputError } from "./meta-tools"

function isRecoverableToolError(error: unknown): boolean {
  if (shouldThrowToolFailures()) return false
  if (error instanceof ToolInputError) return true

  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : ""

  if (typeof error === "object" && error !== null) {
    const record = error as { name?: unknown; toolName?: unknown }
    if (
      record.name === "AI_NoSuchToolError" ||
      record.name === "AI_InvalidToolInputError" ||
      record.name === "AI_JSONParseError" ||
      typeof record.toolName === "string"
    ) {
      return true
    }
  }

  return (
    message.includes("AI_NoSuchToolError") ||
    message.includes("NoSuchToolError") ||
    message.includes("AI_InvalidToolInputError") ||
    message.includes("AI_JSONParseError")
  )
}

export function runAgent(opts: {
  messages: ModelMessage[]
  buildTools: (writer: UIMessageStreamWriter) => ToolSet
  model?: LanguageModel
  abortSignal?: AbortSignal
  system?: string
}): ReadableStream<UIMessageChunk> {
  const { messages, buildTools, model = createModel(), abortSignal, system } = opts
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
          tools,
          onError: (e) => {
            if (!isRecoverableToolError(e)) console.error("[agent tool error]", e)
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
