import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../../../src/main/core/agent/prompt'

describe('buildSystemPrompt', () => {
  it('renders request-specific context', () => {
    const prompt = buildSystemPrompt(
      '{{ platform }}|{{ cwd }}|{{ workingMemoryDirectory }}|{{ longTermMemoryDirectory }}',
      'D:/workspace'
    )

    expect(prompt).toContain('D:/workspace')
    expect(prompt).toContain('working-memory')
    expect(prompt).toContain('long-term-memory')
    expect(prompt).not.toContain('{{')
  })
})
