import type { ToolSet, UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  prepareMessages,
  sanitizeMessages,
  toModelMessages
} from '../../../../src/main/core/agent/messages'

describe('message sanitizer', () => {
  it('removes interrupted assistant tool calls without results', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'run a tool' }]
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'I will check.' },
          {
            type: 'tool-call_tool',
            toolCallId: 'call-1',
            state: 'input-available',
            input: { title: 'Check', name: 'file.read', args: {} }
          }
        ]
      } as UIMessage
    ]

    expect(sanitizeMessages(messages)).toEqual([
      messages[0],
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I will check.' }]
      }
    ])
  })

  it('keeps completed tool calls', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-call_tool',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { title: 'List', name: 'fs.ls', args: {} },
          output: 'ok'
        }
      ]
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([message])
  })

  it.each(['output-error', 'output-denied'])('keeps tools in the %s state', (state) => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'dynamic-tool', toolCallId: 'call-1', toolName: 'test', state }]
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([message])
  })

  it('removes empty assistant messages after dropping incomplete tools', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-call_tool',
          toolCallId: 'call-1',
          state: 'input-streaming',
          input: { title: 'List' }
        }
      ]
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([])
  })

  it('drops invalid UI messages after sanitizing', async () => {
    const messages = [
      {
        id: 'bad',
        role: 'assistant',
        parts: [{ type: 'text' }]
      },
      {
        id: 'good',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }]
      }
    ] as unknown as UIMessage[]

    expect(await prepareMessages(messages)).toEqual([messages[1]])
  })

  it('preserves message order while dropping invalid messages', async () => {
    const messages = [
      { id: 'first', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { id: 'bad', role: 'assistant', parts: [{ type: 'text' }] },
      { id: 'last', role: 'assistant', parts: [{ type: 'text', text: 'last' }] }
    ] as unknown as UIMessage[]

    expect((await prepareMessages(messages)).map(({ id }) => id)).toEqual(['first', 'last'])
  })

  it('handles empty input', async () => {
    expect(sanitizeMessages([])).toEqual([])
    expect(await prepareMessages([])).toEqual([])
    expect(await toModelMessages([])).toEqual([])
  })

  it('converts attachments to paths only for model input', async () => {
    const message: UIMessage = {
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'file', url: 'C:/work/input.pdf', mediaType: 'application/pdf' },
        { type: 'text', text: '总结附件' }
      ]
    }

    expect(await toModelMessages([message])).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Attached paths:\n- C:/work/input.pdf\n\n' },
          { type: 'text', text: '总结附件' }
        ]
      }
    ])
    expect(message.parts[0].type).toBe('file')
  })

  it('converts multiple attachments in their original order', async () => {
    const message: UIMessage = {
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'file', url: 'C:/one.txt', mediaType: 'text/plain' },
        { type: 'file', url: 'C:/two.txt', mediaType: 'text/plain' }
      ]
    }

    expect(await toModelMessages([message])).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Attached paths:\n- C:/one.txt\n- C:/two.txt\n\n' }]
      }
    ])
    expect(message.parts).toHaveLength(2)
  })

  it('uses the stored diagnostics when replaying historical tool output', async () => {
    let currentDiagnostics = 'diagnostics from the changed file'
    const tools = {
      fs_write: {
        inputSchema: {} as never,
        toModelOutput: ({ output }: { output: { summary: string; diagnostics?: string } }) => ({
          type: 'text',
          value: output.summary + (output.diagnostics ?? currentDiagnostics)
        })
      }
    } as unknown as ToolSet
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-fs_write',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { path: 'sample.ts', content: 'old' },
          output: {
            summary: 'File updated.',
            diagnostics: '\n- Line 1: stored diagnostic',
            patch: 'large patch that must not reach the model'
          }
        }
      ]
    } as UIMessage

    const first = await toModelMessages([message], tools)
    currentDiagnostics = 'different diagnostics after the file changed'
    const second = await toModelMessages([message], tools)

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toContain('stored diagnostic')
    expect(JSON.stringify(second)).not.toContain('large patch')
    expect(JSON.stringify(second)).not.toContain(currentDiagnostics)
  })
})
