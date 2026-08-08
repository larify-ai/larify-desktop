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
          initialHasMore: false,
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
          initialHasMore: true,
          initialCwd: 'D:\\Workspace',
          onHeadingChange: vi.fn(),
          onSaved: vi.fn()
        })
      )
    })
    const initial = mocks.assistant.mock.calls.at(-1)![0] as {
      chat: { messages: UIMessage[] }
      firstItemIndex: number
      onLoadOlder: () => Promise<void>
    }

    await act(async () => initial.onLoadOlder())
    const loaded = mocks.assistant.mock.calls.at(-1)![0] as {
      chat: { messages: UIMessage[] }
      firstItemIndex: number
      onLoadOlder?: () => Promise<void>
    }

    expect(invoke).toHaveBeenCalledWith('session:msgs', 'session', 1, 51)
    expect(loaded.chat.messages.map(({ id }) => id)).toEqual(['older', 'latest'])
    expect(loaded.firstItemIndex).toBe(initial.firstItemIndex - 1)
    expect(loaded.onLoadOlder).toBeUndefined()

    await act(async () => root.unmount())
  })
})
