import type { LanguageModelUsage, ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  contextRollover,
  contextRolloverPrompt
} from '../../../../src/main/core/agent/context-rollover'

const usage = (inputTokens: number): LanguageModelUsage => ({
  inputTokens,
  outputTokens: 0,
  totalTokens: inputTokens
})

const messages: ModelMessage[] = [{ role: 'user', content: 'Work on the task.' }]

function options(
  inputTokens: number,
  currentMessages = messages
): Parameters<ReturnType<typeof contextRollover>>[0] {
  return {
    steps: [{ usage: usage(inputTokens) }],
    messages: currentMessages
  } as Parameters<ReturnType<typeof contextRollover>>[0]
}

describe('contextRollover', () => {
  it('keeps context reset independent from visible progress', () => {
    expect(contextRolloverPrompt).toContain('Markdown handoff')
    expect(contextRolloverPrompt).not.toContain('show_progress')
    expect(contextRolloverPrompt).not.toContain('`title`')
  })

  it('does not remind below the threshold', async () => {
    expect(await contextRollover(10_000)(options(9_999))).toBeUndefined()
  })

  it('injects a hidden user reminder at the threshold', async () => {
    const result = await contextRollover(10_000)(options(10_000))

    expect(result?.messages).toEqual([
      ...messages,
      { role: 'user', content: contextRolloverPrompt }
    ])
  })

  it('reminds only once within the same model context', async () => {
    const prepareStep = contextRollover(10_000)
    const first = await prepareStep(options(10_000))

    expect(await prepareStep(options(20_000, first?.messages))).toBeUndefined()
  })

  it('recognizes an existing reminder represented as text content', async () => {
    const currentMessages: ModelMessage[] = [
      ...messages,
      { role: 'user', content: [{ type: 'text', text: contextRolloverPrompt }] }
    ]

    expect(await contextRollover(10_000)(options(20_000, currentMessages))).toBeUndefined()
  })

  it('can remind again in a fresh model context', async () => {
    const prepareStep = contextRollover(10_000)
    await prepareStep(options(10_000))

    expect(await prepareStep(options(10_000, messages))).toBeDefined()
  })
})
