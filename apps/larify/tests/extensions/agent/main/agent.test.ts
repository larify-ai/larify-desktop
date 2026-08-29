import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { isLoopFinished, type UIMessage } from 'ai'
import type { LanguageModelV4FinishReason } from '@ai-sdk/provider'
import { runAgentSession } from '../../../../src/main/core/agent'

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

const finishReason = (
  unified: LanguageModelV4FinishReason['unified']
): LanguageModelV4FinishReason => ({ unified, raw: undefined })

function mockModel(chunks: string[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: '0' },
        ...chunks.map((delta) => ({ type: 'text-delta' as const, id: '0', delta })),
        { type: 'text-end', id: '0' },
        {
          type: 'finish',
          finishReason: finishReason('stop'),
          usage: {
            inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 }
          }
        }
      ])
    })
  })
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

async function assemble(model: MockLanguageModelV4): Promise<UIMessage> {
  const session = await runAgentSession(
    [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    {
      tools: {},
      activeTools: [],
      toolsContext: {},
      model
    }
  )
  return session.at(-1)!
}

describe('runAgent', () => {
  it('streams chunks that assemble into an assistant message', async () => {
    const message = await assemble(mockModel(['I2C ', 'bus 1: ', '0x48, 0x76']))
    expect(message.role).toBe('assistant')
    expect(textOf(message)).toBe('I2C bus 1: 0x48, 0x76')
  })

  it('forwards the messages to the model', async () => {
    const model = mockModel(['ok'])
    await assemble(model)
    const sent = model.doStreamCalls[0].prompt
    expect(JSON.stringify(sent)).toContain('hi')
  })
})

describe('runAgentSession', () => {
  it('preserves the original UI messages and appends the response', async () => {
    const original: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }
    ]
    const session = await runAgentSession(original, {
      tools: {},
      activeTools: [],
      toolsContext: {},
      model: mockModel(['hello'])
    })

    const messages = session
    expect(messages.slice(0, -1)).toEqual(original)
    expect(textOf(messages.at(-1)!)).toBe('hello')
  })

  it('reports UI stream chunks', async () => {
    const chunks: string[] = []
    const session = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      {
        tools: {},
        activeTools: [],
        toolsContext: {},
        model: mockModel(['hello'])
      },
      (chunk) => chunks.push(chunk.type)
    )

    expect(session.at(-1)?.role).toBe('assistant')
    expect(chunks).toContain('text-delta')
  })

  it('reports tool input and output chunks across steps', async () => {
    let calls = 0
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream(
          calls++ === 0
            ? [
                { type: 'stream-start', warnings: [] },
                {
                  type: 'tool-call',
                  toolCallId: 'call-1',
                  toolName: 'echo',
                  input: '{"text":"hello"}'
                },
                { type: 'finish', finishReason: finishReason('tool-calls'), usage: USAGE }
              ]
            : [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: '0' },
                { type: 'text-delta', id: '0', delta: 'done' },
                { type: 'text-end', id: '0' },
                { type: 'finish', finishReason: finishReason('stop'), usage: USAGE }
              ]
        )
      })
    })
    const chunks: string[] = []
    const steps: UIMessage[] = []
    const session = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      {
        tools: {
          echo: {
            description: 'echo',
            inputSchema: z.object({ text: z.string() }),
            execute: async ({ text }) => text
          }
        },
        activeTools: ['echo'],
        toolsContext: {},
        model,
        stopWhen: isLoopFinished()
      },
      (chunk) => chunks.push(chunk.type),
      (message) => steps.push(message)
    )

    expect(session.at(-1)?.role).toBe('assistant')
    expect(chunks).toEqual(
      expect.arrayContaining(['tool-input-available', 'tool-output-available', 'text-delta'])
    )
    expect(steps).toHaveLength(2)
    expect(steps[0].parts.some((part) => part.type === 'tool-echo')).toBe(true)
    expect(textOf(steps[1])).toBe('done')
    expect(steps[1].id).toBe(session.at(-1)?.id)
    expect(steps[1].parts).toEqual(session.at(-1)?.parts)
    expect(steps[1].metadata).toEqual({ startedAt: expect.any(Number) })
    expect(session.at(-1)?.metadata).toEqual({
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      totalProcessingMs: expect.any(Number)
    })
  })

  it('preserves client tool metadata in UI messages', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'ask',
            input: '{"message":"Continue?"}'
          },
          { type: 'finish', finishReason: finishReason('tool-calls'), usage: USAGE }
        ])
      })
    })
    const session = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      {
        tools: {
          ask: {
            description: 'ask',
            inputSchema: z.object({ message: z.string() }),
            metadata: { icon: 'message-square-text' }
          }
        },
        activeTools: ['ask'],
        toolsContext: {},
        model
      }
    )

    expect(session.at(-1)?.parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-ask',
        toolMetadata: { icon: 'message-square-text' }
      })
    )
  })

  it('preserves tool error messages', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'fail',
            input: '{}'
          },
          { type: 'finish', finishReason: finishReason('tool-calls'), usage: USAGE }
        ])
      })
    })
    const errors: string[] = []
    const session = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      {
        tools: {
          fail: {
            description: 'fail',
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error('navigation failed: ERR_CONNECTION_RESET')
            }
          }
        },
        activeTools: ['fail'],
        toolsContext: {},
        model,
        stopWhen: () => true
      },
      (chunk) => {
        if (chunk.type === 'tool-output-error') errors.push(chunk.errorText)
      }
    )

    expect(session.at(-1)?.role).toBe('assistant')
    expect(errors).toEqual(['navigation failed: ERR_CONNECTION_RESET'])
  })

  it('forwards streaming errors to the UI', async () => {
    const parts = [
      { type: 'stream-start' as const, warnings: [] },
      { type: 'text-start' as const, id: '0' },
      { type: 'text-delta' as const, id: '0', delta: 'partial response' }
    ]
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          pull(controller) {
            const part = parts.shift()
            if (part) controller.enqueue(part)
            else controller.error(new Error('interrupted'))
          }
        })
      })
    })
    const original: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] }
    ]
    const errors: string[] = []
    const session = await runAgentSession(
      original,
      {
        tools: {},
        activeTools: [],
        toolsContext: {},
        model
      },
      (chunk) => {
        if (chunk.type === 'error') errors.push(chunk.errorText)
      }
    )

    expect(session.at(-1)?.role).toBe('assistant')
    expect(textOf(session.at(-1)!)).toBe('partial response')
    expect(errors).toEqual(['interrupted'])
    expect(session.at(-1)?.metadata).toEqual({
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      outcome: 'error',
      totalProcessingMs: expect.any(Number)
    })
  })

  it('records elapsed-time metadata when the stream fails before start', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.error(new Error('connection failed'))
          }
        })
      })
    })

    const session = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      {
        tools: {},
        activeTools: [],
        toolsContext: {},
        model
      }
    )

    const metadata = session.at(-1)?.metadata as
      | { startedAt?: number; completedAt?: number; outcome?: string; totalProcessingMs?: number }
      | undefined
    expect(metadata).toEqual({
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      outcome: 'error',
      totalProcessingMs: expect.any(Number)
    })
    expect(metadata!.completedAt!).toBeGreaterThanOrEqual(metadata!.startedAt!)
  })

  it('accumulates totalProcessingMs across a prior run', async () => {
    // 模拟 ask_user 等待后新一轮 run：已有 assistant 消息携带此前累计值。
    const original: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'prior' }],
        metadata: { startedAt: 1_000, completedAt: 3_000, totalProcessingMs: 2_000 }
      }
    ]
    const result = await runAgentSession(original, {
      tools: {},
      activeTools: [],
      toolsContext: {},
      model: mockModel(['hello'])
    })

    const metadata = result.at(-1)?.metadata as Record<string, unknown>
    expect(typeof metadata.startedAt).toBe('number')
    expect(typeof metadata.completedAt).toBe('number')
    expect(typeof metadata.totalProcessingMs).toBe('number')
    const elapsed = (metadata.completedAt as number) - (metadata.startedAt as number)
    expect(metadata.totalProcessingMs).toBe(2_000 + elapsed)
  })

  it('resets totalProcessingMs when a real user message starts a new turn', async () => {
    const withRealTurn: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Q1' }] },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'A1' }],
        metadata: { startedAt: 1_000, completedAt: 3_000, totalProcessingMs: 2_000 }
      },
      { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'Q2' }] }
    ]
    const result = await runAgentSession(withRealTurn, {
      tools: {},
      activeTools: [],
      toolsContext: {},
      model: mockModel(['hello'])
    })

    const metadata = result.at(-1)?.metadata as Record<string, unknown>
    const elapsed = (metadata.completedAt as number) - (metadata.startedAt as number)
    expect(metadata.totalProcessingMs).toBe(elapsed)
  })

  it('keeps accumulating across a compaction user message (context reset handoff)', async () => {
    const withCompaction: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Q1' }] },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial' }],
        metadata: { startedAt: 1_000, completedAt: 3_000, totalProcessingMs: 2_000 }
      },
      {
        id: 'user-compaction',
        role: 'user',
        metadata: { compaction: true },
        parts: [{ type: 'text', text: '# Handoff\nSummary' }]
      }
    ]
    const result = await runAgentSession(withCompaction, {
      tools: {},
      activeTools: [],
      toolsContext: {},
      model: mockModel(['continuation'])
    })

    const metadata = result.at(-1)?.metadata as Record<string, unknown>
    const elapsed = (metadata.completedAt as number) - (metadata.startedAt as number)
    expect(metadata.totalProcessingMs).toBe(2_000 + elapsed)
  })

  it('records elapsed-time metadata when the run is aborted', async () => {
    const controller = new AbortController()
    let streamStarted!: () => void
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve
    })
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(streamController) {
            streamController.enqueue({ type: 'stream-start', warnings: [] })
            streamController.enqueue({ type: 'text-start', id: '0' })
            streamController.enqueue({ type: 'text-delta', id: '0', delta: 'partial' })
            streamStarted()
            abortSignal?.addEventListener(
              'abort',
              () => streamController.error(abortSignal.reason),
              { once: true }
            )
          }
        })
      })
    })

    const result = runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      {
        tools: {},
        activeTools: [],
        toolsContext: {},
        model,
        abortSignal: controller.signal
      }
    )
    await started
    controller.abort()

    const response = (await result).at(-1)
    expect(response?.metadata).toEqual({
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      outcome: 'aborted',
      totalProcessingMs: expect.any(Number)
    })
  })
})

describe('prompt-cache middleware', () => {
  it('sends only the eager tools to the provider but keeps every tool executable', async () => {
    let sentToolNames: string[] = []
    let lazyRan = false
    let calls = 0
    const tools = {
      eager_tool: {
        description: 'eager',
        inputSchema: z.object({}),
        metadata: { eager: true },
        execute: async () => 'eager ran'
      },
      lazy_tool: {
        description: 'lazy',
        inputSchema: z.object({}),
        execute: async () => {
          lazyRan = true
          return 'lazy ran'
        }
      }
    }
    const model = new MockLanguageModelV4({
      doStream: async ({ tools: sent }) => {
        calls++
        sentToolNames = (sent ?? []).map((t) => t.name)
        if (calls > 1) {
          return {
            stream: convertArrayToReadableStream([
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: '0' },
              { type: 'text-delta', id: '0', delta: 'done' },
              { type: 'text-end', id: '0' },
              { type: 'finish', finishReason: finishReason('stop'), usage: USAGE }
            ])
          }
        }
        return {
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'lazy_tool', input: '{}' },
            { type: 'finish', finishReason: finishReason('tool-calls'), usage: USAGE }
          ])
        }
      }
    })

    const session = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      {
        tools: tools as never,
        activeTools: ['eager_tool'],
        toolsContext: {},
        model,
        stopWhen: isLoopFinished()
      }
    )
    expect(session.at(-1)?.role).toBe('assistant')

    expect(sentToolNames).toEqual(['eager_tool'])
    expect(lazyRan).toBe(true)
    expect(calls).toBe(2)
  })
})
