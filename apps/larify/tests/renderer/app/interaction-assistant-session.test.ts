// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatTransport, UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(function Chat(this: object, options: unknown) {
    Object.assign(this, {
      options,
      messages: (options as { messages?: UIMessage[] }).messages ?? []
    })
  }),
  assistant: vi.fn()
}))

vi.mock('@ai-sdk/react', () => ({ Chat: mocks.chat }))
vi.mock('../../../src/renderer/src/app/interaction/assistant/chat', () => ({
  AssistantChat: (props: unknown) => {
    mocks.assistant(props)
    return null
  }
}))

import { AssistantSession } from '../../../src/renderer/src/app/interaction/assistant/session'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('AssistantSession', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'bridge')
    vi.clearAllMocks()
  })

  it('keeps the same chat when the workspace changes', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const onSaved = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) }
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(AssistantSession, {
          id: 'session',
          title: 'Renamed',
          initialMessages: [],
          initialMessageCount: 0,
          initialCwd: '',
          onHeadingChange: vi.fn(),
          onSaved
        })
      )
    })
    const initial = mocks.assistant.mock.calls.at(-1)![0] as {
      chat: { options: { transport: ChatTransport<UIMessage> } }
      title: string
      onCwdChange: (cwd: string) => void
    }

    expect(initial.title).toBe('Renamed')
    await act(async () => initial.onCwdChange('D:\\Workspace\\project'))
    const changed = mocks.assistant.mock.calls.at(-1)![0] as { chat: unknown; cwd: string }

    expect(mocks.chat).toHaveBeenCalledOnce()
    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({ id: 'session' }))
    expect(changed.chat).toBe(initial.chat)
    expect(changed.cwd).toBe('D:\\Workspace\\project')

    const stream = await initial.chat.options.transport.sendMessages({
      chatId: 'session',
      messageId: undefined,
      messages: [{ id: 'message', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      trigger: 'submit-message'
    })
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'agent:send',
        expect.objectContaining({ cwd: 'D:\\Workspace\\project' })
      )
    )
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    await stream.cancel()

    await act(async () => root.unmount())
  })

  it('prepends older messages without moving the virtual list', async () => {
    const older = [{ id: 'older', role: 'assistant', parts: [] }] as UIMessage[]
    const latest = [{ id: 'latest', role: 'assistant', parts: [] }] as UIMessage[]
    const invoke = vi.fn((channel: string) =>
      Promise.resolve(channel === 'session:msgs' ? older : undefined)
    )
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) }
    })
    const root = createRoot(document.createElement('div'))

    await act(async () => {
      root.render(
        createElement(AssistantSession, {
          id: 'session',
          initialMessages: latest,
          initialMessageCount: 2,
          initialCwd: 'D:\\Workspace',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const initial = mocks.assistant.mock.calls.at(-1)![0] as {
      chat: { messages: UIMessage[] }
      olderMessages: Map<number, UIMessage>
      onLoadRange: (firstPage: number, lastPage: number) => void
    }

    await act(async () => initial.onLoadRange(0, 0))
    const loaded = mocks.assistant.mock.calls.at(-1)![0] as {
      chat: { messages: UIMessage[] }
      olderMessages: Map<number, UIMessage>
    }

    expect(invoke).toHaveBeenCalledWith('session:msgs', 'session', 0, 1)
    expect(loaded.chat.messages.map(({ id }) => id)).toEqual(['latest'])
    expect(loaded.olderMessages.get(0)?.id).toBe('older')

    await act(async () => root.unmount())
  })

  it('does not load the same page twice while it is pending', async () => {
    let resolvePage!: (messages: UIMessage[]) => void
    const page = new Promise<UIMessage[]>((resolve) => {
      resolvePage = resolve
    })
    const invoke = vi.fn((channel: string, value: unknown) =>
      channel === 'session:msgs' ? page : Promise.resolve(value)
    )
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) }
    })
    const root = createRoot(document.createElement('div'))

    await act(async () => {
      root.render(
        createElement(AssistantSession, {
          id: 'session',
          initialMessages: [message('latest')],
          initialMessageCount: 2,
          initialCwd: '',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const session = mocks.assistant.mock.calls.at(-1)![0] as {
      onLoadRange: (firstPage: number, lastPage: number) => void
    }

    act(() => {
      session.onLoadRange(0, 0)
      session.onLoadRange(0, 0)
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'session:msgs')).toHaveLength(1)

    await act(async () => resolvePage([message('older')]))
    await act(async () => root.unmount())
  })

  it('keeps virtual indexes non-negative when the initial count is stale', async () => {
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke: vi.fn(), on: vi.fn(() => () => undefined) }
    })
    const root = createRoot(document.createElement('div'))

    await act(async () => {
      root.render(
        createElement(AssistantSession, {
          id: 'session',
          initialMessages: [message('one'), message('two')],
          initialMessageCount: 1,
          initialCwd: '',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })

    expect(mocks.assistant.mock.calls.at(-1)![0]).toEqual(
      expect.objectContaining({ initialMessageCount: 2, recentStart: 0 })
    )
    await act(async () => root.unmount())
  })

  it('keeps only the active page window and discards stale responses', async () => {
    let resolveFirst!: (messages: UIMessage[]) => void
    let resolveSecond!: (messages: UIMessage[]) => void
    const first = new Promise<UIMessage[]>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<UIMessage[]>((resolve) => {
      resolveSecond = resolve
    })
    const invoke = vi.fn((channel: string, _id: string, offset?: number) => {
      if (channel === 'attachment:load') return Promise.resolve(_id)
      if (channel !== 'session:msgs') return Promise.resolve(undefined)
      return offset === 0 ? first : second
    })
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) }
    })
    const root = createRoot(document.createElement('div'))

    await act(async () => {
      root.render(
        createElement(AssistantSession, {
          id: 'session',
          initialMessages: [message('latest')],
          initialMessageCount: 101,
          initialCwd: 'D:\\Workspace',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const initial = mocks.assistant.mock.calls.at(-1)![0] as {
      onLoadRange: (firstPage: number, lastPage: number) => void
    }

    act(() => initial.onLoadRange(0, 0))
    act(() => initial.onLoadRange(1, 1))
    await act(async () => resolveSecond([message('page-1')]))
    await vi.waitFor(() => {
      const current = mocks.assistant.mock.calls.at(-1)![0] as {
        olderMessages: Map<number, UIMessage>
      }
      expect(current.olderMessages.get(50)?.id).toBe('page-1')
    })

    await act(async () => resolveFirst([message('stale')]))
    const current = mocks.assistant.mock.calls.at(-1)![0] as {
      olderMessages: Map<number, UIMessage>
    }
    expect(current.olderMessages.has(0)).toBe(false)
    expect(current.olderMessages.get(50)?.id).toBe('page-1')

    await act(async () => root.unmount())
  })
})

function message(id: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text: id }] }
}
