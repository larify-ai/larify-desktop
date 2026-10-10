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
  // smoothStream,
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

// 流级恢复（streamRetries）的可重试判定：与上方 ai-retry 的"黑名单外一概重试"
// 策略保持一致——用户主动取消、SDK 校验/配置类错误、客户端 4xx（429 限流除外）
// 不重试；其余（网络中断 terminated/ECONNRESET、5xx、SSE Overloaded 等）视为
// 瞬时错误，请求重跑当前失败的模型 step。
export function isRetryableStreamError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return false
  if (AISDKError.isInstance(error) && !APICallError.isInstance(error)) return false
  if (APICallError.isInstance(error) && typeof error.statusCode === 'number') {
    const code = error.statusCode
    if (code !== 429 && code >= 400 && code < 500) return false
  }
  return true
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
    // DeepSeek 的 `max_tokens` 官方默认仅 4096，长任务（如一次写几十个文件）会中途被
    // 截断（finishReason=length），导致该轮的最终答复丢失，故显式设大。
    //
    // 但 `max_tokens` 是**预留额度**而非实际生成量，且**输入与输出共用同一个 1M 窗口**
    // （官方文档：输入 token 和输出 token 的总长度受上下文长度限制）。请求发出时输出尚
    // 未生成，服务端只能按「输入 + max_tokens」预估，超出即 400：
    //   This model's maximum context length is 1048576 tokens. However, you requested
    //   1048833 tokens (655617 in the messages, 393216 in the completion).
    //
    // 曾取模型上限 384 * 1024（=393216，与官方 `max_tokens` 上限一致），但那会把可用的
    // 输入预算压到 1048576 − 393216 = 655360，而 rollover 阈值是 800000 —— 阈值落在安全
    // 输入上限**之后**，于是「输入未达阈值、请求却已越界」：rollover 永不触发，服务端直接拒绝。
    //
    // 现取 200 * 1024（=204800）：安全输入上限抬到 1048576 − 204800 = 843776，高于 rollover
    // 800000，守门重新落在红线之前。实测单轮最长输出约 91K token，200K 仍有充足余量。
    // 不变量：`rollover + maxOutputTokens < limit`（见 model/config.ts 的 modelContextWindows）。
    maxOutputTokens: 200 * 1024,
    maxRetries: 0,
    // 流级恢复：内容已流出后（mid-stream）收到错误时，只重跑失败的模型 step，
    // 保留已完成的历史 steps、工具调用与工具结果（不重放已完成工作）。
    // streamRetries: 0 关闭自动流重试，改由 onError 回调精确控制：仅对瞬时
    // 错误（terminated/ECONNRESET/5xx/429 等）请求重试，不重试用户主动取消。
    // 与上方 ai-retry 互补：ai-retry 负责"内容未流出"的重试，本处负责"内容流出后"。
    streamRetries: 0,
    onError: ({ error }) => (isRetryableStreamError(error) ? { retry: true } : undefined),
    toolsContext: toolsContext as never
    // experimental_transform: smoothStream({
    //   delayInMs: 20,
    //   chunking: new Intl.Segmenter('zh', { granularity: 'word' })
    // })
  }).stream
}
