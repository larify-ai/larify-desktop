import type { ModelMessage, PrepareStepFunction, ToolSet } from 'ai'

export const contextRolloverPrompt =
  'Because the accumulated context becomes too large, first update the task and memory representations in Chinese following the `task-representation` and `memory-representation` skills to help prevent context loss, then call `agent_reset_context` with a Markdown handoff linking to the relevant task and memory files to reset the model context.'

function includesRolloverPrompt(messages: ModelMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'user') return false
    if (typeof message.content === 'string') return message.content === contextRolloverPrompt
    return message.content.some(
      (part) => part.type === 'text' && part.text === contextRolloverPrompt
    )
  })
}

export function contextRollover(
  threshold: number
): PrepareStepFunction<ToolSet, Record<string, never>> {
  return ({ steps, messages }) => {
    if ((steps.at(-1)?.usage.inputTokens ?? 0) < threshold || includesRolloverPrompt(messages)) {
      return undefined
    }

    return {
      messages: [...messages, { role: 'user', content: contextRolloverPrompt }]
    }
  }
}
