// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { lastAssistantMessageIsCompleteWithToolCalls, type ChatTransport, type UIMessage } from 'ai'
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

  it('keeps the current navigation visible while an updated index is loading', async () => {
    let resolveUpdated!: (value: unknown[]) => void
    const updated = new Promise<unknown[]>((resolve) => {
      resolveUpdated = resolve
    })
    let navigationRequests = 0
    const invoke = vi.fn((channel: string) => {
      if (channel !== 'session:navigation') return Promise.resolve(undefined)
      navigationRequests += 1
      return navigationRequests === 1
        ? Promise.resolve([{ id: 'old', index: 10, promptPreview: 'old' }])
        : updated
    })
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) }
    })
    const root = createRoot(document.createElement('div'))
    const props = {
      id: 'session',
      initialMessages: [message('latest')],
      initialCwd: '',
      onCwdChange: vi.fn(),
      onHeadingChange: vi.fn(),
      onSaved: vi.fn().mockResolvedValue(undefined)
    }

    await act(async () => {
      root.render(createElement(AssistantSession, { ...props, initialMessageCount: 11 }))
    })
    expect(mocks.assistant.mock.calls.at(-1)![0]).toMatchObject({
      navigationItems: [{ id: 'old', index: 10, promptPreview: 'old' }]
    })

    await act(async () => {
      root.render(createElement(AssistantSession, { ...props, initialMessageCount: 12 }))
    })
    expect(mocks.assistant.mock.calls.at(-1)![0]).toMatchObject({
      navigationItems: [{ id: 'old', index: 10, promptPreview: 'old' }]
    })

    await act(async () => {
      resolveUpdated([{ id: 'new', index: 11, promptPreview: 'new' }])
    })
    expect(mocks.assistant.mock.calls.at(-1)![0]).toMatchObject({
      navigationItems: [{ id: 'new', index: 11, promptPreview: 'new' }]
    })

    await act(async () => root.unmount())
  })

  it('prepends older navigation items without duplicating existing entries', async () => {
    const invoke = vi.fn((channel: string, _id: unknown, beforeIndex?: number) => {
      if (channel !== 'session:navigation') return Promise.resolve(undefined)
      return Promise.resolve(
        beforeIndex === 100
          ? [
              { id: 'older', index: 50, promptPreview: 'older' },
              { id: 'recent', index: 100, promptPreview: 'recent' }
            ]
          : [{ id: 'recent', index: 100, promptPreview: 'recent' }]
      )
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
          initialCwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange: vi.fn(),
          onSaved: vi.fn().mockResolvedValue(undefined)
        })
      )
    })
    const current = mocks.assistant.mock.calls.at(-1)![0] as {
      onLoadOlderNavigation: () => void
    }
    await act(async () => current.onLoadOlderNavigation())

    expect(mocks.assistant.mock.calls.at(-1)![0]).toMatchObject({
      navigationItems: [
        { id: 'older', index: 50, promptPreview: 'older' },
        { id: 'recent', index: 100, promptPreview: 'recent' }
      ]
    })
    await act(async () => root.unmount())
  })

  it('keeps the same chat when the workspace changes', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const onSaved = vi.fn().mockResolvedValue(undefined)
    const onCwdChange = vi.fn()
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
          onCwdChange,
          onHeadingChange: vi.fn(),
          onSaved
        })
      )
    })
    const initial = mocks.assistant.mock.calls.at(-1)![0] as {
      chat: {
        options: {
          sendAutomaticallyWhen: typeof lastAssistantMessageIsCompleteWithToolCalls
          transport: ChatTransport<UIMessage>
        }
      }
      title: string
      onCwdChange: (cwd: string) => void
    }

    expect(initial.title).toBe('Renamed')
    expect(initial.chat.options.sendAutomaticallyWhen).toBe(
      lastAssistantMessageIsCompleteWithToolCalls
    )
    await act(async () => initial.onCwdChange('D:\\Workspace\\project'))
    const changed = mocks.assistant.mock.calls.at(-1)![0] as { chat: unknown }

    expect(mocks.chat).toHaveBeenCalledOnce()
    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({ id: 'session' }))
    expect(changed.chat).toBe(initial.chat)
    expect(onCwdChange).toHaveBeenCalledWith('D:\\Workspace\\project')

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

  it('syncs a reused draft to its newly selected workspace', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke, on: vi.fn(() => () => undefined) }
    })
    const root = createRoot(document.createElement('div'))
    const props = {
      id: 'draft',
      initialMessages: [],
      initialMessageCount: 0,
      onCwdChange: vi.fn(),
      onHeadingChange: vi.fn(),
      onSaved: vi.fn().mockResolvedValue(undefined)
    }

    await act(async () => {
      root.render(createElement(AssistantSession, { ...props, initialCwd: '' }))
    })
    await act(async () => {
      root.render(
        createElement(AssistantSession, { ...props, initialCwd: 'D:\\Workspace\\project' })
      )
    })

    const current = mocks.assistant.mock.calls.at(-1)![0] as {
      chat: { options: { transport: ChatTransport<UIMessage> } }
      cwd: string
    }
    expect(current.cwd).toBe('D:\\Workspace\\project')

    const stream = await current.chat.options.transport.sendMessages({
      chatId: 'draft',
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

  it('loads adjacent historical pages in one request and one render', async () => {
    const invoke = vi.fn((channel: string, _id: string, offset?: number, limit?: number) =>
      channel === 'session:msgs'
        ? Promise.resolve(
            Array.from({ length: limit ?? 0 }, (_, index) => message(`page-${offset! + index}`))
          )
        : Promise.resolve(undefined)
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
          initialMessageCount: 251,
          initialCwd: '',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const session = mocks.assistant.mock.calls.at(-1)![0] as {
      onLoadRange: (firstPage: number, lastPage: number) => void
    }
    const rendersBeforeLoad = mocks.assistant.mock.calls.length

    await act(async () => session.onLoadRange(0, 4))

    expect(invoke.mock.calls.filter(([channel]) => channel === 'session:msgs')).toEqual([
      ['session:msgs', 'session', 0, 250]
    ])
    expect(mocks.assistant.mock.calls.length - rendersBeforeLoad).toBe(1)
    const loaded = mocks.assistant.mock.calls.at(-1)![0] as {
      olderMessages: Map<number, UIMessage>
    }
    expect(loaded.olderMessages.size).toBe(250)

    await act(async () => root.unmount())
  })

  it('releases every page in a failed batch so the visible range can retry', async () => {
    let messageAttempts = 0
    const invoke = vi.fn((channel: string, value?: unknown) => {
      if (channel === 'attachment:load') return Promise.resolve(value)
      if (channel !== 'session:msgs') return Promise.resolve([])
      messageAttempts += 1
      return messageAttempts === 1
        ? Promise.reject(new Error('temporary failure'))
        : Promise.resolve([message('retried')])
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
          initialMessageCount: 251,
          initialCwd: '',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const session = mocks.assistant.mock.calls.at(-1)![0] as {
      onLoadRange: (firstPage: number, lastPage: number) => void
    }

    await act(async () => session.onLoadRange(0, 4))
    await act(async () => session.onLoadRange(2, 2))

    expect(invoke.mock.calls.filter(([channel]) => channel === 'session:msgs')).toEqual([
      ['session:msgs', 'session', 0, 250],
      ['session:msgs', 'session', 100, 50]
    ])
    const loaded = mocks.assistant.mock.calls.at(-1)![0] as {
      olderMessages: Map<number, UIMessage>
    }
    expect(loaded.olderMessages.get(100)?.id).toBe('retried')

    await act(async () => root.unmount())
  })

  it('loads only the missing tail when a visible range overlaps a pending batch', async () => {
    let resolveFirst!: (messages: UIMessage[]) => void
    const first = new Promise<UIMessage[]>((resolve) => {
      resolveFirst = resolve
    })
    const invoke = vi.fn((channel: string, _id: string, offset?: number, limit?: number) => {
      if (channel !== 'session:msgs') return Promise.resolve(undefined)
      if (offset === 0) return first
      return Promise.resolve(
        Array.from({ length: limit ?? 0 }, (_, index) => message(`tail-${offset! + index}`))
      )
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
          initialMessageCount: 351,
          initialCwd: '',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const session = mocks.assistant.mock.calls.at(-1)![0] as {
      onLoadRange: (firstPage: number, lastPage: number) => void
    }

    act(() => session.onLoadRange(0, 4))
    await act(async () => session.onLoadRange(2, 6))

    expect(invoke.mock.calls.filter(([channel]) => channel === 'session:msgs')).toEqual([
      ['session:msgs', 'session', 0, 250],
      ['session:msgs', 'session', 250, 100]
    ])

    await act(async () => resolveFirst([]))
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
      expect.objectContaining({ recentStart: 0 })
    )
    await act(async () => root.unmount())
  })

  it('retains loaded pages when adjacent requests finish out of order', async () => {
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
    expect(current.olderMessages.get(0)?.id).toBe('stale')
    expect(current.olderMessages.get(50)?.id).toBe('page-1')

    await act(async () => root.unmount())
  })

  it('keeps previously loaded pages after the next page becomes ready', async () => {
    let resolveSecond!: (messages: UIMessage[]) => void
    const second = new Promise<UIMessage[]>((resolve) => {
      resolveSecond = resolve
    })
    const invoke = vi.fn((channel: string, value: unknown, offset?: number) => {
      if (channel === 'attachment:load') return Promise.resolve(value)
      if (channel !== 'session:msgs') return Promise.resolve(undefined)
      return offset === 0 ? Promise.resolve([message('page-0')]) : second
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
    const session = mocks.assistant.mock.calls.at(-1)![0] as {
      onLoadRange: (firstPage: number, lastPage: number) => void
    }

    await act(async () => session.onLoadRange(0, 0))
    act(() => session.onLoadRange(1, 1))
    let current = mocks.assistant.mock.calls.at(-1)![0] as {
      olderMessages: Map<number, UIMessage>
    }
    expect(current.olderMessages.get(0)?.id).toBe('page-0')

    await act(async () => resolveSecond([message('page-1')]))
    current = mocks.assistant.mock.calls.at(-1)![0] as {
      olderMessages: Map<number, UIMessage>
    }
    expect(current.olderMessages.get(0)?.id).toBe('page-0')
    expect(current.olderMessages.get(50)?.id).toBe('page-1')

    await act(async () => root.unmount())
  })
})

function message(id: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text: id }] }
}
