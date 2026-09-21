import type { ModelMessage, PrepareStepFunction, ToolSet } from 'ai'
import { estimateTokens } from './token-estimate'

export const contextRolloverPrompt = 'Because the accumulated context becomes too large, first update the task progress and knowledge representation to help prevent context loss, finally call `agent_reset_context` with a Markdown handoff linking to the related files to reset the model context and continue from the handoff.'

function includesRolloverPrompt(messages: ModelMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'user') return false
    if (typeof message.content === 'string') return message.content === contextRolloverPrompt
    return message.content.some(
      (part) => part.type === 'text' && part.text === contextRolloverPrompt
    )
  })
}

/**
 * 上下文守门：当**本次将发的 `messages`** 的预估输入越过阈值时，插入一句隐藏提示，
 * 让模型先更新任务进度与知识表示，再调 `agent_reset_context` 重置上下文。
 *
 * ⚠️ 判据读的是「**本次**请求的预估输入」，**不是** `steps.at(-1)?.usage.inputTokens`。
 * 后者是**上一步**模型返回的实测用量，会同时犯两个错（本项目的真实事故即由此产生）：
 * ① **step#0 时 `steps` 为空** ⇒ 读 `0` ⇒ 恒不触发（「首步无量」）；
 * ② **step#n 时读的是 step n−1** ⇒ 滞后一步，而本步输入可能已经越窗。
 * 两个面都让守门在**被服务端拒绝的那次请求**上判「安全」。
 *
 * ⇒ 改为按 `messages`（AI SDK 在每个 step 发请求前都会传入本次要发的消息）做预估，
 * 首步就有值、也不再滞后。**机制一字不改**（仍只插提示、不做截断/硬裁），
 * 只把「读什么」修正为「读本次」。
 * 详见 [上下文守门读错了量](file:///C:/Users/hylnb/.larify/memory/larify-desktop/context-rollover-reads-wrong-quantity.md)。
 */
export function contextRollover(
  threshold: number
): PrepareStepFunction<ToolSet, Record<string, never>> {
  return ({ messages }) => {
    if (estimateTokens(messages) < threshold || includesRolloverPrompt(messages)) {
      return undefined
    }

    return {
      messages: [...messages, { role: 'user', content: contextRolloverPrompt }]
    }
  }
}
