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
  let root: Root

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
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('connects chat state to the message list and composer', async () => {
    const chat = { id: 'session' }
    const onCwdChange = vi.fn()
    const onHeadingChange = vi.fn()
    await act(async () =>
      root.render(
        createElement(AssistantChat, {
          chat: chat as never,
          cwd: '',
          onCwdChange,
          onHeadingChange
        })
      )
    )

    expect(mocks.useChat).toHaveBeenCalledWith({ chat, throttle: 50 })
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        live: true,
        messages: mocks.useChat.mock.results[0].value.messages
      })
    )

    const composer = mocks.composer.mock.calls[0][0]
    expect(composer.history).toEqual(['first message', 'second'])
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
    expect(onHeadingChange).toHaveBeenCalledWith({
      cwd: 'D:\\Workspace\\project',
      title: 'first message'
    })
    expect(onHeadingChange).not.toHaveBeenCalledWith(null)
  })
})

function message(role: UIMessage['role'], texts: string[]): UIMessage {
  return {
    id: crypto.randomUUID(),
    role,
    parts: texts.map((text) => ({ type: 'text' as const, text }))
  }
}
