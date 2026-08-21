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
    const sendCall = bridge.invoke.mock.calls.find(([channel]) => channel === 'agent:send')
    expect(sendCall?.[1]).not.toHaveProperty('runId')
    expect(bridge.invoke.mock.calls.slice(0, 2).map(([channel]) => channel)).toEqual([
      'attachment:save',
      'agent:send'
    ])
    expect(bridge.listenerCount()).toBe(0)
  })

  it('sends the persisted attachment path to the agent', async () => {
    const saved = {
      id: 'message-1',
      role: 'user' as const,
      parts: [{ type: 'file' as const, mediaType: 'image/png', url: 'C:/attachments/image.png' }]
    }
    const bridge = createBridge(async (channel, value) => {
      if (channel === 'attachment:save') return saved
      if (channel === 'agent:send') bridge.emit('agent:end:session-1')
      return value
    })
    vi.stubGlobal('window', { bridge })

    await readAll(await send())

    expect(bridge.invoke).toHaveBeenCalledWith(
      'agent:send',
      expect.objectContaining({ message: saved })
    )
  })

  it('forwards generated session titles while the stream is open', async () => {
    const bridge = createBridge(async (channel) => {
      if (channel !== 'agent:send') return
      bridge.emit('agent:title:session-1', 'Generated title')
      bridge.emit('agent:end:session-1')
    })
    const onTitle = vi.fn()
    vi.stubGlobal('window', { bridge })
    const transport = createIpcTransport(
      () => 'C:/workspace',
      () => defaultModelConfig,
      undefined,
      onTitle
    )

    await readAll(
      await transport.sendMessages({
        chatId: 'session-1',
        messageId: undefined,
        messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        trigger: 'submit-message'
      })
    )

    expect(onTitle).toHaveBeenCalledWith('Generated title')
    expect(bridge.listenerCount()).toBe(0)
  })

  it('notifies after the backend accepts and stores the message', async () => {
    const bridge = createBridge()
    const onSaved = vi.fn().mockResolvedValue(undefined)
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

  it('does not delay the stream while the directory refresh completes', async () => {
    const bridge = createBridge()
    const refresh = Promise.withResolvers<void>()
    vi.stubGlobal('window', { bridge })
    const transport = createIpcTransport(
      () => 'C:/workspace',
      () => defaultModelConfig,
      () => refresh.promise
    )
    const stream = await transport.sendMessages({
      chatId: 'session-1',
      messageId: undefined,
      messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      trigger: 'submit-message'
    })
    const read = stream.getReader().read()

    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:send', expect.anything())
    )
    bridge.emit('agent:end:session-1')
    await expect(read).resolves.toEqual({ done: true, value: undefined })

    refresh.resolve()
  })

  it('keeps the agent stream independent from a directory refresh failure', async () => {
    const error = new Error('refresh failed')
    const bridge = createBridge()
    const onSaved = vi.fn().mockRejectedValue(error)
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
    bridge.emit('agent:end:session-1')
    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
    expect(bridge.listenerCount()).toBe(0)
  })

  it('keeps the agent stream independent when directory refresh throws synchronously', async () => {
    const bridge = createBridge()
    const onSaved = vi.fn(() => {
      throw new Error('refresh failed')
    })
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
    bridge.emit('agent:end:session-1')
    await expect(stream.getReader().read()).resolves.toEqual({ done: true, value: undefined })
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

  it('cancels a started response without inventing frontend lifecycle chunks', async () => {
    const bridge = createBridge()
    const abort = new AbortController()
    vi.stubGlobal('window', { bridge })
    const stream = await send(abort.signal)
    bridge.emit('agent:chunk:session-1', { type: 'start' })
    abort.abort()
    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')

    expect(await readAll(stream)).toEqual([{ type: 'start' }])
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

  it('does not start the agent when cancelled while saving attachments', async () => {
    const attachments = Promise.withResolvers<unknown>()
    const bridge = createBridge(async (channel) => {
      if (channel === 'attachment:save') return attachments.promise
    })
    const abort = new AbortController()
    vi.stubGlobal('window', { bridge })
    const stream = await send(abort.signal)

    abort.abort()
    attachments.resolve({ id: 'message-1', role: 'user', parts: [] })
    expect(await readAll(stream)).toEqual([])
    await Promise.resolve()
    await Promise.resolve()
    expect(bridge.invoke.mock.calls.map(([channel]) => channel)).not.toContain('agent:send')
  })

  it('cancels the backend and releases listeners when the consumer cancels the stream', async () => {
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge })
    const reader = (await send()).getReader()

    await reader.cancel()

    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')
    expect(bridge.listenerCount()).toBe(0)
  })

  it('does not start the agent when the consumer cancels while saving attachments', async () => {
    const attachments = Promise.withResolvers<unknown>()
    const bridge = createBridge(async (channel) => {
      if (channel === 'attachment:save') return attachments.promise
    })
    vi.stubGlobal('window', { bridge })
    const reader = (await send()).getReader()

    await reader.cancel()
    attachments.resolve({ id: 'message-1', role: 'user', parts: [] })
    await Promise.resolve()
    await Promise.resolve()

    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')
    expect(bridge.invoke.mock.calls.map(([channel]) => channel)).not.toContain('agent:send')
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

function createBridge(invokeImplementation?: (channel: string, value?: unknown) => unknown): {
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
