import { AISDKError, APICallError, type LanguageModelV4 } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import {
  aborted,
  and,
  createRetryableModel,
  error,
  finishReason,
  not,
  or
} from 'ai-retry/language-model'
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
  // 网络错误重试（同模型、指数退避）；429/5xx 等可重试 API 错误同样兜底。
  // maxRetries: 0 让 ai-retry 作为唯一重试权威，避免与 SDK 内置重试叠加。
  const retry = { delay: 1_000, backoffFactor: 2, maxAttempts: 3 }
  const retryableModel = createRetryableModel({
    model,
    retries: [
      // 错误层：黑名单之外一概重试。瞬态错误形态（网络中断 terminated/ECONNRESET、
      // 5xx、429、SSE "Overloaded" 等）无需逐一枚举，未来新增形态自动被覆盖。
      // 不重试：用户主动取消；SDK 校验/配置类错误（AISDKError 且非 APICallError）；
      // 客户端错误（4xx，429 除外——429 是可重试的限流）。
      not(
        or(
          aborted(),
          // SDK 校验/配置类错误：AISDKError 且非 APICallError
          and(error.isInstance(AISDKError), not(error.isInstance(APICallError))),
          error.statusCode(400, 401, 402, 403, 404, 405, 413, 414, 415, 422, 423)
        )
      ).retry(retry),
      // 结果层：非正常结束才重试。DeepSeek 断流表现为
      // finish_reason: insufficient_system_resource（→ unified 'error'）或
      // 无 finish_reason 的静默截断（→ unified 'other'）；
      // stop / tool-calls / length / content-filter 视为正常，不重试。
      or(finishReason('error'), finishReason('other')).retry(retry)
    ]
  })
  const wrappedModel = wrapLanguageModel({
    model: retryableModel,
    middleware: [toolImages(imageCapable), promptWithTools(activeTools)]
  })
  return streamText({
    ...streamOptions,
    model: wrappedModel,
    messages,
    maxRetries: 0,
    toolsContext: toolsContext as never,
    experimental_transform: smoothStream({
      delayInMs: 20,
      chunking: new Intl.Segmenter('zh', { granularity: 'word' })
    })
  }).stream
}
