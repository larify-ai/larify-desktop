import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'
import { defaultModelConfig } from '../../../src/main/core/model/config'
import { createIpcTransport } from '../../../src/renderer/src/app/interaction/assistant/transport'

type Listener = (value?: unknown) => void

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('interaction assistant transport', () => {
  it('forwards the request and streamed chunks, then releases listeners', async () => {
    const bridge = createBridge(async (channel, request) => {
      if (channel !== 'agent:send') return
      const sessionId = (request as { sessionId: string }).sessionId
      bridge.emit(`agent:chunk:${sessionId}`, { type: 'text-start', id: 'text' })
      bridge.emit(`agent:chunk:${sessionId}`, { type: 'text-delta', id: 'text', delta: 'hello' })
      bridge.emit(`agent:end:${sessionId}`)
    })
    vi.stubGlobal('window', { bridge })

    expect(await readAll(await send())).toEqual([
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'hello' }
    ])
    expect(bridge.invoke).toHaveBeenCalledWith(
      'agent:send',
      expect.objectContaining({
        sessionId: 'session-1',
        message: expect.objectContaining({ id: 'message-1', role: 'user' }),
        cwd: 'C:/workspace',
        modelConfig: defaultModelConfig
      })
    )
    expect(bridge.invoke.mock.calls[0][1]).not.toHaveProperty('runId')
    expect(bridge.listenerCount()).toBe(0)
  })

  it('notifies after the backend accepts and stores the message', async () => {
    const bridge = createBridge()
    const onSaved = vi.fn()
    vi.stubGlobal('window', { bridge })
    const transport = createIpcTransport(
      () => 'C:/workspace',
      () => defaultModelConfig,
      onSaved
    )

    const stream = await transport.sendMessages({
      chatId: 'session-1',
      messageId: undefined,
      messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      trigger: 'submit-message'
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    await stream.cancel()
  })

  it('errors the stream and releases listeners when starting the run fails', async () => {
    const error = new Error('run failed')
    const bridge = createBridge(async () => {
      throw error
    })
    vi.stubGlobal('window', { bridge })

    const reader = (await send()).getReader()
    await expect(reader.read()).rejects.toBe(error)
    expect(bridge.listenerCount()).toBe(0)
  })

  it('cleans up when starting the run throws synchronously', async () => {
    const error = new Error('synchronous failure')
    const bridge = createBridge()
    bridge.invoke.mockImplementationOnce(() => {
      throw error
    })
    vi.stubGlobal('window', { bridge })

    await expect((await send()).getReader().read()).rejects.toBe(error)
    expect(bridge.listenerCount()).toBe(0)
  })

  it('forwards a backend error and ignores later terminal events', async () => {
    const error = new Error('backend failed')
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge })
    const reader = (await send()).getReader()

    bridge.emit('agent:error:session-1', error)
    bridge.emit('agent:end:session-1')

    await expect(reader.read()).rejects.toBe(error)
    expect(bridge.listenerCount()).toBe(0)
  })

  it('does not start a run when already aborted', async () => {
    const bridge = createBridge()
    const abort = new AbortController()
    abort.abort()
    vi.stubGlobal('window', { bridge })

    expect(await readAll(await send(abort.signal))).toEqual([])
    expect(bridge.invoke).not.toHaveBeenCalled()
    expect(bridge.listenerCount()).toBe(0)
  })

  it('cancels a running request and waits for its end event', async () => {
    const bridge = createBridge()
    const abort = new AbortController()
    vi.stubGlobal('window', { bridge })
    const stream = await send(abort.signal)
    abort.abort()
    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')
    bridge.emit('agent:end:session-1')

    expect(await readAll(stream)).toEqual([])
    expect(bridge.listenerCount()).toBe(0)
  })

  it('errors and cleans up when cancellation fails', async () => {
    const error = new Error('cancel failed')
    const bridge = createBridge(async (channel) => {
      if (channel === 'agent:cancel') throw error
    })
    const abort = new AbortController()
    vi.stubGlobal('window', { bridge })
    const reader = (await send(abort.signal)).getReader()

    abort.abort()

    await expect(reader.read()).rejects.toBe(error)
    expect(bridge.listenerCount()).toBe(0)
  })

  it('cancels the backend and releases listeners when the consumer cancels the stream', async () => {
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge })
    const reader = (await send()).getReader()

    await reader.cancel()

    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')
    expect(bridge.listenerCount()).toBe(0)
  })

  it('rejects an empty message list without registering listeners', async () => {
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge })
    const transport = createIpcTransport(
      () => 'C:/workspace',
      () => defaultModelConfig
    )

    await expect(
      transport.sendMessages({
        chatId: 'session-1',
        messageId: undefined,
        messages: [],
        trigger: 'submit-message'
      })
    ).rejects.toThrow('A message is required.')
    expect(bridge.listenerCount()).toBe(0)
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('does not register listeners when request configuration fails', async () => {
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge })
    const transport = createIpcTransport(
      () => {
        throw new Error('cwd failed')
      },
      () => defaultModelConfig
    )

    await expect(
      transport.sendMessages({
        chatId: 'session-1',
        messageId: undefined,
        messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        trigger: 'submit-message'
      })
    ).rejects.toThrow('cwd failed')
    expect(bridge.listenerCount()).toBe(0)
    expect(bridge.invoke).not.toHaveBeenCalled()
  })
})

function createBridge(invokeImplementation?: (channel: string, value?: unknown) => Promise<void>): {
  invoke: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  emit: (channel: string, value?: unknown) => void
  listenerCount: () => number
} {
  const listeners = new Map<string, Set<Listener>>()
  return {
    invoke: vi.fn(invokeImplementation ?? (async () => undefined)),
    on: vi.fn((channel: string, listener: Listener) => {
      const current = listeners.get(channel) ?? new Set()
      current.add(listener)
      listeners.set(channel, current)
      return () => current.delete(listener)
    }),
    emit(channel: string, value?: unknown) {
      listeners.get(channel)?.forEach((listener) => listener(value))
    },
    listenerCount() {
      return [...listeners.values()].reduce((count, current) => count + current.size, 0)
    }
  }
}

function send(abortSignal?: AbortSignal): Promise<ReadableStream<UIMessageChunk>> {
  return createIpcTransport(
    () => 'C:/workspace',
    () => defaultModelConfig
  ).sendMessages({
    abortSignal,
    chatId: 'session-1',
    messageId: undefined,
    messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    trigger: 'submit-message'
  })
}

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = []
  const reader = stream.getReader()
  for (;;) {
    const result = await reader.read()
    if (result.done) return chunks
    chunks.push(result.value)
  }
}
