// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { UIMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  composer: vi.fn(),
  list: vi.fn(),
  sendMessage: vi.fn(),
  stop: vi.fn(),
  useChat: vi.fn()
}))

vi.mock('@ai-sdk/react', () => ({ useChat: mocks.useChat }))
vi.mock('../../../src/renderer/src/app/interaction/assistant/message-list', () => ({
  AssistantMessageList: (props: unknown) => {
    mocks.list(props)
    return null
  }
}))
vi.mock('../../../src/renderer/src/app/interaction/assistant/composer', () => ({
  AssistantComposer: (props: unknown) => {
    mocks.composer(props)
    return null
  }
}))

import { AssistantChat } from '../../../src/renderer/src/app/interaction/assistant/chat'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('AssistantChat', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    mocks.useChat.mockReturnValue({
      messages: [
        message('user', ['first', ' message']),
        message('assistant', ['answer']),
        message('user', ['', 'second'])
      ],
      sendMessage: mocks.sendMessage,
      status: 'streaming',
      stop: mocks.stop
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('connects chat state to the message list and composer', async () => {
    const chat = { id: 'session' }
    const onCwdChange = vi.fn()
    const onHeadingChange = vi.fn()
    const onLoadRange = vi.fn()
    const olderMessages = new Map()
    await act(async () =>
      root.render(
        createElement(AssistantChat, {
          chat: chat as never,
          cwd: '',
          initialMessageCount: 3,
          recentStart: 0,
          olderMessages,
          onLoadRange,
          onCwdChange,
          onHeadingChange
        })
      )
    )

    expect(mocks.useChat).toHaveBeenCalledWith({ chat, throttle: 50 })
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        live: true,
        messages: mocks.useChat.mock.results[0].value.messages,
        initialMessageCount: 3,
        recentStart: 0,
        olderMessages,
        onLoadRange
      })
    )

    const composer = mocks.composer.mock.calls[0][0]
    expect(composer.history).toEqual(['first message', 'second'])
    expect(composer.status).toBe('streaming')
    expect(composer.showWorkspace).toBe(false)
    expect(composer.onCwdChange).toBe(onCwdChange)
    expect(onHeadingChange).toHaveBeenCalledWith({ cwd: '', title: 'first message' })
    composer.onSubmit({ text: 'hello', files: [] })
    composer.onStop()
    expect(mocks.sendMessage).toHaveBeenCalledWith({ text: 'hello', files: [] })
    expect(mocks.stop).toHaveBeenCalledOnce()

    onHeadingChange.mockClear()
    await act(async () =>
      root.render(
        createElement(AssistantChat, {
          chat: chat as never,
          cwd: 'D:\\Workspace\\project',
          onCwdChange,
          onHeadingChange
        })
      )
    )
    expect(onHeadingChange).not.toHaveBeenCalled()
  })

  it('does not clear a started session heading when unmounted', async () => {
    const onHeadingChange = vi.fn()
    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange
        })
      )
    )
    onHeadingChange.mockClear()

    act(() => root?.unmount())
    root = null

    expect(onHeadingChange).not.toHaveBeenCalledWith(null)
  })

  it('does not create a heading for an empty session', async () => {
    mocks.useChat.mockReturnValue({
      messages: [],
      sendMessage: mocks.sendMessage,
      status: 'ready',
      stop: mocks.stop
    })
    const onHeadingChange = vi.fn()

    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange
        })
      )
    )

    expect(onHeadingChange).not.toHaveBeenCalled()
  })

  it('keeps an unnamed heading when the first user message has no text', async () => {
    mocks.useChat.mockReturnValue({
      messages: [{ id: 'attachment', role: 'user', parts: [] }, message('user', ['later title'])],
      sendMessage: mocks.sendMessage,
      status: 'ready',
      stop: mocks.stop
    })
    const onHeadingChange = vi.fn()

    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange
        })
      )
    )

    expect(onHeadingChange).toHaveBeenCalledWith({ cwd: '', title: '未命名任务' })
    expect(mocks.composer.mock.calls[0][0].history).toEqual(['later title'])
  })

  it('does not replace an existing title when messages change', async () => {
    const onHeadingChange = vi.fn()
    const chat = { id: 'session' } as never
    const props = {
      chat,
      title: 'Renamed',
      cwd: '',
      onCwdChange: vi.fn(),
      onHeadingChange
    }

    await act(async () => root?.render(createElement(AssistantChat, props)))
    mocks.useChat.mockReturnValue({
      messages: [message('user', ['new message'])],
      sendMessage: mocks.sendMessage,
      status: 'ready',
      stop: mocks.stop
    })
    await act(async () => root?.render(createElement(AssistantChat, props)))

    expect(onHeadingChange).not.toHaveBeenCalled()
  })

  it('creates a title only once while input history keeps updating', async () => {
    const onHeadingChange = vi.fn()
    const chat = { id: 'session' } as never
    const props = {
      chat,
      cwd: '',
      onCwdChange: vi.fn(),
      onHeadingChange
    }

    await act(async () => root?.render(createElement(AssistantChat, props)))
    onHeadingChange.mockClear()
    mocks.useChat.mockReturnValue({
      messages: [message('user', ['first message']), message('user', ['later message'])],
      sendMessage: mocks.sendMessage,
      status: 'ready',
      stop: mocks.stop
    })
    await act(async () => root?.render(createElement(AssistantChat, props)))

    expect(onHeadingChange).not.toHaveBeenCalled()
    expect(mocks.composer.mock.lastCall?.[0].history).toEqual(['first message', 'later message'])
  })

  it('uses only the first line and limits a generated title to 60 characters', async () => {
    const firstLine = 'a'.repeat(70)
    mocks.useChat.mockReturnValue({
      messages: [message('user', [`${firstLine}\nsecond line`])],
      sendMessage: mocks.sendMessage,
      status: 'ready',
      stop: mocks.stop
    })
    const onHeadingChange = vi.fn()

    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange
        })
      )
    )

    expect(onHeadingChange).toHaveBeenCalledWith({ cwd: '', title: 'a'.repeat(60) })
    expect(mocks.list.mock.lastCall?.[0].live).toBe(false)
  })
})

function message(role: UIMessage['role'], texts: string[]): UIMessage {
  return {
    id: crypto.randomUUID(),
    role,
    parts: texts.map((text) => ({ type: 'text' as const, text }))
  }
}
