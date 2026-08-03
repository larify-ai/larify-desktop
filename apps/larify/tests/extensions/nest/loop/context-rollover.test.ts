import { describe, expect, it } from 'vitest'
import {
  CONTEXT_ROLLOVER_PROMPT,
  contextRollover
} from '../../../../src/extensions/nest/loop/context-rollover'

function options(inputTokens: number): Parameters<ReturnType<typeof contextRollover>>[0] {
  return {
    steps: [{ usage: { inputTokens } }],
    messages: [{ role: 'user', content: 'task' }]
  } as never
}

describe('context rollover', () => {
  it('requests rollover once at the configured threshold', async () => {
    const prepareStep = contextRollover(800)

    expect(await prepareStep(options(799))).toBeUndefined()
    expect(await prepareStep(options(800))).toEqual({
      messages: [
        { role: 'user', content: 'task' },
        { role: 'user', content: CONTEXT_ROLLOVER_PROMPT }
      ]
    })
    expect(await prepareStep(options(900))).toBeUndefined()
    expect(CONTEXT_ROLLOVER_PROMPT).toContain(
      'call `nest_submit_verdict` with `{ "verdict": "schedule" }`'
    )
  })
})
