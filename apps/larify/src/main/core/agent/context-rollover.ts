import type { ModelMessage, PrepareStepFunction, ToolSet } from 'ai'

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
