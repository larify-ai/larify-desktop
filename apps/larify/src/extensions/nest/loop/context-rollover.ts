import type { PrepareStepFunction, ToolSet } from 'ai'

export const CONTEXT_ROLLOVER_PROMPT =
  'Because the accumulated context is too large, immediately complete the handoff by following the applicable `nest-explore` or `nest-critique` skill to propose tasks recursively, update the context representation, append the event, and schedule the next task. Finally, return `{ "verdict": "schedule" }`.'

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
