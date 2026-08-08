import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { createAgentRuntime, runAgentSession } from '../../../../src/main/core/agent'

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

describe.skipIf(!process.env.LIVE)('runAgent (live DeepSeek)', () => {
  it('streams a real reply from DeepSeek', async () => {
    const messages = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: '只回复四个字：你好世界' }] }],
      createAgentRuntime({ sessionId: 'live', cwd: process.cwd() })
    )
    const last = messages.at(-1)
    const text = last ? textOf(last) : ''
    console.log('DeepSeek 回复:', JSON.stringify(text))
    expect(last?.role).toBe('assistant')
    expect(text.length).toBeGreaterThan(0)
  }, 30_000)
})
