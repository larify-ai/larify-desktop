import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { sessionAttentionState } from '../../../../../src/renderer/src/app/interaction/assistant/session-attention'

describe('session attention state', () => {
  it('maps submitted and streaming chats to active', () => {
    expect(sessionAttentionState('submitted', [])).toBe('active')
    expect(sessionAttentionState('streaming', [])).toBe('active')
  })

  it('prioritizes pending user input over streaming', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'agent_ask_user',
            toolCallId: 'call',
            state: 'input-available',
            input: {}
          }
        ]
      }
    ]

    expect(sessionAttentionState('ready', messages)).toBe('waiting')
  })

  it('recognizes an approval request as waiting', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'terminal',
            toolCallId: 'call',
            state: 'approval-requested',
            input: {},
            approval: { id: 'approval' }
          }
        ]
      }
    ]

    expect(sessionAttentionState('streaming', messages)).toBe('waiting')
  })

  it('maps a settled or failed chat to idle', () => {
    expect(sessionAttentionState('ready', [])).toBe('idle')
    expect(sessionAttentionState('error', [])).toBe('idle')
  })

  it('does not treat ordinary tool input as waiting for the user', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'terminal',
            toolCallId: 'call',
            state: 'input-available',
            input: {}
          }
        ]
      }
    ]

    expect(sessionAttentionState('streaming', messages)).toBe('active')
    expect(sessionAttentionState('ready', messages)).toBe('idle')
  })
})
