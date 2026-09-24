import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'
import { defaultModelConfig } from '../../../src/main/core/model/config'

const h = vi.hoisted(() => ({ invalidateGitStatus: vi.fn() }))

vi.mock('../../../src/extensions/workspace/renderer/changes/git-status-invalidation', () => h)

import { createIpcTransport } from '../../../src/renderer/src/app/interaction/assistant/transport'

type Listener = (value?: unknown) => void

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('interaction assistant transport', () => {
  it('invalidates Git status for streamed change cards and when the run finishes', async () => {
    const bridge = createBridge(async (channel) => {
      if (channel !== 'agent:send') return
      bridge.emit('agent:chunk:session-1', {
        type: 'data-git-snapshot',
        data: { files: [], root: 'C:/workspace' }
      })
      bridge.emit('agent:end:session-1')
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

    await readAll(await send())

    expect(h.invalidateGitStatus).toHaveBeenCalledTimes(2)
    expect(h.invalidateGitStatus).toHaveBeenNthCalledWith(1, 'C:/workspace')
    expect(h.invalidateGitStatus).toHaveBeenNthCalledWith(2, 'C:/workspace')
  })

  it('forwards the request and streamed chunks, then releases listeners', async () => {
    const bridge = createBridge(async (channel, request) => {
      if (channel !== 'agent:send') return
      const sessionId = (request as { sessionId: string }).sessionId
      bridge.emit(`agent:chunk:${sessionId}`, { type: 'text-start', id: 'text' })
      bridge.emit(`agent:chunk:${sessionId}`, { type: 'text-delta', id: 'text', delta: 'hello' })
      bridge.emit(`agent:end:${sessionId}`)
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

    await expect((await send()).getReader().read()).rejects.toBe(error)
    expect(bridge.listenerCount()).toBe(0)
  })

  it('forwards a backend error and ignores later terminal events', async () => {
    const error = new Error('backend failed')
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

    expect(await readAll(await send(abort.signal))).toEqual([])
    expect(bridge.invoke).not.toHaveBeenCalled()
    expect(bridge.listenerCount()).toBe(0)
  })

  it('cancels a started response without inventing frontend lifecycle chunks', async () => {
    const bridge = createBridge()
    const abort = new AbortController()
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    const stream = await send(abort.signal)
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:send', expect.anything())
    )
    bridge.emit('agent:chunk:session-1', { type: 'start' })
    abort.abort()
    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')

    expect(await readAll(stream)).toEqual([{ type: 'start' }])
    expect(bridge.listenerCount()).toBe(0)
    expect(vi.mocked(window.dispatchEvent)).toHaveBeenCalled()
  })

  it('dispatches the usage-changed event when the stream is cancelled directly', async () => {
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    const stream = await send()
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:send', expect.anything())
    )

    await stream.cancel()

    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')
    expect(vi.mocked(window.dispatchEvent)).toHaveBeenCalled()
    expect(bridge.listenerCount()).toBe(0)
  })

  it('errors and cleans up when cancellation fails', async () => {
    const error = new Error('cancel failed')
    const bridge = createBridge(async (channel) => {
      if (channel === 'agent:cancel') throw error
    })
    const abort = new AbortController()
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    const reader = (await send(abort.signal)).getReader()
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:send', expect.anything())
    )

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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    const reader = (await send()).getReader()
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:send', expect.anything())
    )

    await reader.cancel()

    expect(bridge.invoke).toHaveBeenCalledWith('agent:cancel', 'session-1')
    expect(h.invalidateGitStatus).toHaveBeenCalledOnce()
    expect(h.invalidateGitStatus).toHaveBeenCalledWith('C:/workspace')
    expect(bridge.listenerCount()).toBe(0)
  })

  it('invalidates Git status when consumer cancellation fails', async () => {
    const error = new Error('cancel failed')
    const bridge = createBridge(async (channel) => {
      if (channel === 'agent:cancel') throw error
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    const reader = (await send()).getReader()
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:send', expect.anything())
    )

    await expect(reader.cancel()).rejects.toBe(error)

    expect(h.invalidateGitStatus).toHaveBeenCalledOnce()
    expect(bridge.listenerCount()).toBe(0)
  })

  it('does not start the agent when the consumer cancels while saving attachments', async () => {
    const attachments = Promise.withResolvers<unknown>()
    const bridge = createBridge(async (channel) => {
      if (channel === 'attachment:save') return attachments.promise
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    const reader = (await send()).getReader()

    await reader.cancel()
    attachments.resolve({ id: 'message-1', role: 'user', parts: [] })
    await Promise.resolve()
    await Promise.resolve()

    expect(bridge.invoke).not.toHaveBeenCalledWith('agent:cancel', 'session-1')
    expect(h.invalidateGitStatus).not.toHaveBeenCalled()
    expect(bridge.invoke.mock.calls.map(([channel]) => channel)).not.toContain('agent:send')
    expect(bridge.listenerCount()).toBe(0)
  })

  it('rejects an empty message list without registering listeners', async () => {
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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

  it('attaches the user-configured own API key to the model config', async () => {
    const bridge = createBridge(async (channel) => {
      if (channel === 'agent:send') bridge.emit('agent:end:session-1')
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    vi.stubGlobal('localStorage', {
      getItem: () => ' sk-own-123 ',
      setItem: vi.fn(),
      removeItem: vi.fn()
    })

    await readAll(await send())

    expect(bridge.invoke).toHaveBeenCalledWith(
      'agent:send',
      expect.objectContaining({
        modelConfig: { ...defaultModelConfig, apiKey: 'sk-own-123' }
      })
    )
  })

  it('passes no UI target id for a new question (last message is a user)', async () => {
    // 新提问（末条是刚发的 user）⇒ `uiTargetId` 必须是 `undefined`（新建一条），
    // **不能**取「最后一条 assistant」，否则新回复会被并进上一轮的回复。
    const bridge = createBridge(async (channel) => {
      if (channel === 'agent:send') bridge.emit('agent:end:session-1')
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

    await readAll(
      await createIpcTransport(
        () => 'C:/workspace',
        () => defaultModelConfig
      ).sendMessages({
        chatId: 'session-1',
        messageId: undefined,
        messages: [
          { id: 'message-1', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
          { id: 'message-2', role: 'user', parts: [{ type: 'text', text: 'next question' }] }
        ],
        trigger: 'submit-message'
      })
    )

    expect(bridge.invoke).toHaveBeenCalledWith(
      'agent:send',
      expect.objectContaining({ uiTargetId: undefined })
    )
  })

  it('passes the last assistant id as the UI target id for a continuation', async () => {
    // 续写（末条是 assistant，如 ask_user 回答）⇒ 下传它的 id ⇒ 主进程据此全链复用同一 UI id。
    const bridge = createBridge(async (channel) => {
      if (channel === 'agent:send') bridge.emit('agent:end:session-1')
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })

    await readAll(
      await createIpcTransport(
        () => 'C:/workspace',
        () => defaultModelConfig
      ).sendMessages({
        chatId: 'session-1',
        messageId: undefined,
        messages: [
          { id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'ask' }] },
          { id: 'assistant-x', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] }
        ],
        trigger: 'submit-message'
      })
    )

    expect(bridge.invoke).toHaveBeenCalledWith(
      'agent:send',
      expect.objectContaining({ uiTargetId: 'assistant-x' })
    )
  })

  it('treats a whitespace-only stored key as unconfigured', async () => {
    const bridge = createBridge(async (channel) => {
      if (channel === 'agent:send') bridge.emit('agent:end:session-1')
    })
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
    vi.stubGlobal('localStorage', {
      getItem: () => '   ',
      setItem: vi.fn(),
      removeItem: vi.fn()
    })

    await readAll(await send())

    expect(bridge.invoke).toHaveBeenCalledWith(
      'agent:send',
      expect.objectContaining({ modelConfig: defaultModelConfig })
    )
  })

  it('does not register listeners when request configuration fails', async () => {
    const bridge = createBridge()
    vi.stubGlobal('window', { bridge, dispatchEvent: vi.fn() })
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
