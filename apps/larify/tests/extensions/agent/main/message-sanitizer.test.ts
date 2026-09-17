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

  it('keeps ask-user calls while waiting for user input', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-available',
          toolMetadata: { icon: 'message-square-text' },
          input: {
            message: 'Choose a mode',
            options: [{ label: 'Safe' }]
          }
        }
      ]
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([message])
  })

  it('drops a pending ask-user call when it is no longer the last message', () => {
    const assistant = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Choose a mode.' },
        {
          type: 'tool-agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { message: 'Continue?', options: [{ label: 'Yes' }] }
        }
      ]
    } as UIMessage
    const user = {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'Do something else instead.' }]
    } as UIMessage

    expect(sanitizeMessages([assistant, user])).toEqual([
      { ...assistant, parts: [assistant.parts[0]] },
      user
    ])
  })

  it('drops a superseded dynamic ask-user call', () => {
    const assistant = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { message: 'Continue?', options: [{ label: 'Yes' }] }
        }
      ]
    } as UIMessage
    const user = {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'New request' }]
    } as UIMessage

    expect(sanitizeMessages([assistant, user])).toEqual([user])
  })

  it('converts history after removing a superseded ask-user call', async () => {
    const tools = { agent_ask_user: { inputSchema: {} as never } } as unknown as ToolSet
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-agent_ask_user',
            toolCallId: 'call-1',
            state: 'input-available',
            input: { message: 'Continue?', options: [{ label: 'Yes' }] }
          }
        ]
      },
      {
        id: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'New request' }]
      }
    ] as UIMessage[]

    const prepared = await prepareMessages(messages)

    expect(prepared).toEqual([messages[1]])
    await expect(toModelMessages(prepared, tools)).resolves.toEqual([
      { role: 'user', content: [{ type: 'text', text: 'New request' }] }
    ])
  })

  it('keeps dynamic ask-user calls while waiting for user input', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { message: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }
        }
      ]
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([message])
  })

  it('does not keep similarly named or partially streamed ask-user calls', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-agent_ask_users',
          toolCallId: 'call-1',
          state: 'input-available',
          input: {}
        },
        {
          type: 'tool-agent_ask_user',
          toolCallId: 'call-2',
          state: 'input-streaming',
          input: {}
        }
      ]
    } as UIMessage

    expect(sanitizeMessages([message])).toEqual([])
  })

  it('filters tool parts independently without mutating the stored message', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'working' },
        {
          type: 'tool-fs_read',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { path: 'a.txt' }
        },
        {
          type: 'tool-fs_write',
          toolCallId: 'call-2',
          state: 'output-available',
          input: { path: 'b.txt' },
          output: 'done'
        }
      ]
    } as UIMessage

    const result = sanitizeMessages([message])

    expect(result[0].parts).toEqual([message.parts[0], message.parts[2]])
    expect(message.parts).toHaveLength(3)
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

  it('preserves a valid pending ask-user message during preparation', async () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-agent_ask_user',
          toolCallId: 'call-1',
          state: 'input-available',
          toolMetadata: { icon: 'message-square-text' },
          input: {
            message: 'Choose a mode',
            options: [{ label: 'Fast' }, { label: 'Safe' }]
          }
        }
      ]
    } as UIMessage

    expect(await prepareMessages([message])).toEqual([message])
  })

  it('handles empty input', async () => {
    expect(sanitizeMessages([])).toEqual([])
    expect(await prepareMessages([])).toEqual([])
    expect(await toModelMessages([])).toEqual([])
  })

  it('prefixes a user message marked with workflowPrefix, without touching its stored text', async () => {
    const marked: UIMessage = {
      id: 'user-1',
      role: 'user',
      metadata: { workflowPrefix: true },
      parts: [{ type: 'text', text: '调研这个代码库' }]
    }

    const modelMessages = await toModelMessages([marked])

    expect(modelMessages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '/follow_workflow 调研这个代码库' }] }
    ])
    // 不改动入参（落库 text 仍为原文）。
    expect(marked.parts[0]).toEqual({ type: 'text', text: '调研这个代码库' })
  })

  it('does not prefix unmarked users or internal (nested/compaction) users', async () => {
    const plain = {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'plain' }]
    } as UIMessage
    const nested = {
      id: 'user-2',
      role: 'user',
      metadata: { nested: true },
      parts: [{ type: 'text', text: 'nest prompt' }]
    } as UIMessage
    const compaction = {
      id: 'user-3',
      role: 'user',
      metadata: { compaction: true },
      parts: [{ type: 'text', text: '# Handoff' }]
    } as UIMessage

    const modelMessages = await toModelMessages([plain, nested, compaction])

    expect(JSON.stringify(modelMessages)).not.toContain('/follow_workflow')
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

  it('does not rewrite assistant file parts', async () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'file', url: 'file:///result.txt', mediaType: 'text/plain' }]
    } as UIMessage

    const [converted] = await toModelMessages([message])
    const [file] = converted.content as Array<{
      type: string
      data: { type: string; url: URL }
      mediaType: string
    }>

    expect(converted.role).toBe('assistant')
    expect(file.type).toBe('file')
    expect(file.data.url.toString()).toBe('file:///result.txt')
    expect(file.mediaType).toBe('text/plain')
  })

  it('converts a submitted ask-user call into a model-visible tool result', async () => {
    const tools = { agent_ask_user: { inputSchema: {} as never } } as unknown as ToolSet
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-agent_ask_user',
          toolCallId: 'call-1',
          state: 'output-available',
          input: {
            message: 'Choose a mode',
            options: [{ label: 'Fast' }, { label: 'Safe' }]
          },
          output: { answers: ['Safe'] }
        }
      ]
    } as UIMessage

    const modelMessages = await toModelMessages([message], tools)

    expect(JSON.stringify(modelMessages)).toContain('agent_ask_user')
    expect(JSON.stringify(modelMessages)).toContain('Safe')
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
