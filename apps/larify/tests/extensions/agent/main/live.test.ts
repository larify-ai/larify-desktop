import { describe, it, expect } from 'vitest'
import { readUIMessageStream, type UIMessage } from 'ai'
import { runAgentUIStream } from '../../../../src/main/core/agent'

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

describe.skipIf(!process.env.LIVE)('runAgent (live DeepSeek)', () => {
  it('streams a real reply from DeepSeek', async () => {
    const stream = runAgentUIStream({
      messages: [{ role: 'user', content: '只回复四个字：你好世界' }],
      tools: {},
      activeTools: [],
      toolsContext: {}
    })
    let last: UIMessage | undefined
    for await (const m of readUIMessageStream({ stream })) last = m
    const text = last ? textOf(last) : ''
    console.log('DeepSeek 回复:', JSON.stringify(text))
    expect(last?.role).toBe('assistant')
    expect(text.length).toBeGreaterThan(0)
  }, 30_000)
})
