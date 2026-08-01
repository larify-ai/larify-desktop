import type { PrepareStepFunction, ToolSet } from 'ai'

export const CONTEXT_ROLLOVER_PROMPT =
  'Because the context has grown too large, preserve everything necessary to continue in fresh contexts: update the context representation following the `context-representation` skill, append the current progress as an event following the `task-representation` skill, then follow the applicable `nest-explore` or `nest-critique` skill to propose and schedule tasks, and return `schedule`.'

export function contextRollover(
  threshold: number
): PrepareStepFunction<ToolSet, Record<string, never>> {
  let requested = false

  return ({ steps, messages }) => {
    const inputTokens = steps.at(-1)?.usage.inputTokens ?? 0
    if (requested || inputTokens < threshold) return

    requested = true
    return {
      messages: [...messages, { role: 'user', content: CONTEXT_ROLLOVER_PROMPT }]
    }
  }
}
