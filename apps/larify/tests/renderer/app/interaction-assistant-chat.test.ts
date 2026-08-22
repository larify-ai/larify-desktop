// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { UIMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addToolOutput: vi.fn(),
  composer: vi.fn(),
  list: vi.fn(),
  reportAttentionState: vi.fn(),
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  stop: vi.fn(),
  toolOutput: undefined as
    ((tool: string, toolCallId: string, output: unknown) => void) | undefined,
  useChat: vi.fn()
}))

vi.mock('@ai-sdk/react', () => ({ useChat: mocks.useChat }))
vi.mock(
  '../../../src/renderer/src/app/interaction/assistant/session-attention',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../../src/renderer/src/app/interaction/assistant/session-attention')
    >()),
    useSessionAttentionReport: () => mocks.reportAttentionState
  })
)
vi.mock('../../../src/renderer/src/app/interaction/assistant/message-list', async () => {
  const { useToolOutput } =
    await import('../../../src/renderer/src/app/interaction/assistant/tool-output')
  return {
    AssistantMessageList: (props: unknown) => {
      mocks.list(props)
      mocks.toolOutput = useToolOutput()
      return null
    }
  }
})
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
      addToolOutput: mocks.addToolOutput,
      messages: [
        message('user', ['first', ' message']),
        message('assistant', ['answer']),
        message('user', ['', 'second'])
      ],
      sendMessage: mocks.sendMessage,
      setMessages: mocks.setMessages,
      status: 'streaming',
      stop: mocks.stop
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
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
    expect(mocks.reportAttentionState).toHaveBeenCalledWith('session', 'active')
    vi.spyOn(Date, 'now').mockReturnValueOnce(500).mockReturnValue(2_000)
    composer.onSubmit({ text: 'hello', files: [] })
    composer.onStop()
    expect(mocks.sendMessage).toHaveBeenCalledWith({ text: 'hello', files: [] })
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.setMessages).toHaveBeenCalledOnce()
    const updateAfterStop = mocks.setMessages.mock.calls.at(-1)?.[0] as (
      current: UIMessage[]
    ) => UIMessage[]
    const [aborted] = updateAfterStop([
      {
        id: 'assistant',
        role: 'assistant',
        metadata: { startedAt: 1_000 },
        parts: [{ type: 'text', text: 'partial' }]
      }
    ])
    expect(aborted.metadata).toEqual({
      startedAt: 1_000,
      completedAt: expect.any(Number),
      outcome: 'aborted'
    })

    await act(async () => mocks.toolOutput?.('agent_ask_user', 'call-1', ['Safe']))
    expect(mocks.addToolOutput).toHaveBeenCalledWith({
      tool: 'agent_ask_user',
      toolCallId: 'call-1',
      output: ['Safe']
    })
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ followRequest: 1 }))

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

  it('reports attention transitions without repeating an unchanged state', async () => {
    const chat = { id: 'session' } as never
    const props = {
      chat,
      cwd: '',
      onCwdChange: vi.fn(),
      onHeadingChange: vi.fn()
    }
    await act(async () => root?.render(createElement(AssistantChat, props)))
    expect(mocks.reportAttentionState).toHaveBeenLastCalledWith('session', 'active')

    mocks.reportAttentionState.mockClear()
    await act(async () =>
      root?.render(createElement(AssistantChat, { ...props, cwd: 'D:\\Workspace' }))
    )
    expect(mocks.reportAttentionState).not.toHaveBeenCalled()

    mocks.useChat.mockReturnValue({
      addToolOutput: mocks.addToolOutput,
      messages: [
        {
          id: 'assistant',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'agent_ask_user',
              toolCallId: 'call',
              state: 'input-available',
              input: {}
            }
          ]
        }
      ],
      sendMessage: mocks.sendMessage,
      setMessages: mocks.setMessages,
      status: 'ready',
      stop: mocks.stop
    })
    await act(async () => root?.render(createElement(AssistantChat, props)))
    expect(mocks.reportAttentionState).toHaveBeenLastCalledWith('session', 'waiting')

    mocks.useChat.mockReturnValue({
      addToolOutput: mocks.addToolOutput,
      messages: [],
      sendMessage: mocks.sendMessage,
      setMessages: mocks.setMessages,
      status: 'ready',
      stop: mocks.stop
    })
    await act(async () => root?.render(createElement(AssistantChat, props)))
    expect(mocks.reportAttentionState).toHaveBeenLastCalledWith('session', 'idle')
  })

  it('does not overwrite terminal message metadata when stop races with completion', async () => {
    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange: vi.fn()
        })
      )
    )

    const composer = mocks.composer.mock.calls.at(-1)?.[0]
    composer.onStop()
    const update = mocks.setMessages.mock.calls.at(-1)?.[0] as (current: UIMessage[]) => UIMessage[]
    const complete: UIMessage[] = [
      {
        id: 'assistant',
        role: 'assistant',
        metadata: { startedAt: 1_000, completedAt: 2_000 },
        parts: [{ type: 'text', text: 'complete' }]
      }
    ]

    expect(update(complete)).toBe(complete)
    expect(complete[0].metadata).toEqual({ startedAt: 1_000, completedAt: 2_000 })
  })

  it('does not mark the previous response as aborted before the new response starts', async () => {
    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange: vi.fn()
        })
      )
    )

    const composer = mocks.composer.mock.calls.at(-1)?.[0]
    composer.onStop()
    const update = mocks.setMessages.mock.calls.at(-1)?.[0] as (current: UIMessage[]) => UIMessage[]
    const submitted: UIMessage[] = [
      {
        id: 'previous-assistant',
        role: 'assistant',
        metadata: { startedAt: 1_000, completedAt: 2_000 },
        parts: [{ type: 'text', text: 'previous answer' }]
      },
      {
        id: 'current-user',
        role: 'user',
        parts: [{ type: 'text', text: 'new question' }]
      }
    ]

    expect(update(submitted)).toBe(submitted)
    expect(submitted[0].metadata).toEqual({ startedAt: 1_000, completedAt: 2_000 })
  })

  it('replaces stale terminal metadata when an Ask User continuation is interrupted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange: vi.fn()
        })
      )
    )

    act(() => mocks.toolOutput?.('agent_ask_user', 'call-1', ['Continue']))
    vi.setSystemTime(12_000)
    const composer = mocks.composer.mock.calls.at(-1)?.[0]
    act(() => composer.onStop())
    const update = mocks.setMessages.mock.calls.at(-1)?.[0] as (current: UIMessage[]) => UIMessage[]
    const waiting: UIMessage[] = [
      {
        id: 'assistant',
        role: 'assistant',
        metadata: { startedAt: 1_000, completedAt: 5_000 },
        parts: [{ type: 'text', text: 'waiting' }]
      }
    ]

    expect(update(waiting)[0].metadata).toEqual({
      startedAt: 10_000,
      completedAt: 12_000,
      outcome: 'aborted'
    })
  })

  it('requests bottom following after every tool output', async () => {
    await act(async () =>
      root?.render(
        createElement(AssistantChat, {
          chat: { id: 'session' } as never,
          cwd: '',
          onCwdChange: vi.fn(),
          onHeadingChange: vi.fn()
        })
      )
    )

    await act(async () => mocks.toolOutput?.('agent_ask_user', 'call-1', ['First']))
    await act(async () => mocks.toolOutput?.('agent_ask_user', 'call-2', ['Second']))

    expect(mocks.addToolOutput).toHaveBeenNthCalledWith(1, {
      tool: 'agent_ask_user',
      toolCallId: 'call-1',
      output: ['First']
    })
    expect(mocks.addToolOutput).toHaveBeenNthCalledWith(2, {
      tool: 'agent_ask_user',
      toolCallId: 'call-2',
      output: ['Second']
    })
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ followRequest: 2 }))
  })

  it('does not create a heading for an empty session', async () => {
    mocks.useChat.mockReturnValue({
      addToolOutput: mocks.addToolOutput,
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
      addToolOutput: mocks.addToolOutput,
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
      addToolOutput: mocks.addToolOutput,
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
      addToolOutput: mocks.addToolOutput,
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
      addToolOutput: mocks.addToolOutput,
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
