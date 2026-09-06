// @vitest-environment jsdom

import { act, createElement, forwardRef, useEffect, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const captured = vi.hoisted(() => ({
  props: undefined as unknown,
  mounts: 0,
  autoscrollToBottom: vi.fn(),
  scrollToIndex: vi.fn(),
  snapshot: { ranges: [{ endIndex: 0, size: 320, startIndex: 0 }], scrollTop: 240 }
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function Virtuoso(props: unknown, ref) {
    captured.props = props
    useEffect(() => {
      captured.mounts += 1
    }, [])
    useImperativeHandle(ref, () => ({
      autoscrollToBottom: captured.autoscrollToBottom,
      scrollToIndex: captured.scrollToIndex,
      getState: (callback: (snapshot: typeof captured.snapshot) => void) =>
        callback(captured.snapshot)
    }))
    return null
  })
}))

import { AssistantMessageList } from '../../../src/renderer/src/app/interaction/assistant/message-list'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface VirtuosoProps {
  className: string
  scrollerRef(ref: HTMLElement | Window | null): void
  totalCount: number
  defaultItemHeight?: number
  initialItemCount: number
  initialTopMostItemIndex: { index: 'LAST'; align: 'end' } | number
  firstItemIndex: number
  isScrolling(scrolling: boolean): void
  restoreStateFrom?: typeof captured.snapshot
  increaseViewportBy: number
  overscan: number
  followOutput(isAtBottom: boolean): 'auto' | false
  rangeChanged(range: { startIndex: number; endIndex: number }): void
  totalListHeightChanged(height: number): void
  atBottomStateChange(atBottom: boolean): void
  computeItemKey(index: number): React.Key
  itemContent(index: number): React.JSX.Element
}

let container: HTMLDivElement
let root: Root
let resize: () => void

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    resize = () => callback([], this as unknown as ResizeObserver)
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  captured.mounts = 0
  captured.scrollToIndex.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('interaction assistant message list', () => {
  it('starts with a stable historical count and the latest item', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(1)
    expect(props.firstItemIndex).toBe(4999)
    expect(props.initialItemCount).toBe(1)
    expect(props.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' })
    expect(props.computeItemKey(4999)).toBe('latest-0')
    expect(props.className).toContain('larify-scrollbar-hidden')
    expect(props.scrollerRef).toEqual(expect.any(Function))
  })

  it('lays out the first frame with the estimated height instead of a blank viewport', async () => {
    // 切换会话时用户看到"只有背景、然后才出现内容"：Virtuoso 在 initialItemFinalLocationReached
    // 前隐藏列表，未提供 defaultItemHeight 时首次布局依赖测量 → 空白窗口更长。
    // 提供估算高度后，初始范围可立即计算，隐藏窗口趋近于 0。
    await render({ messages: [message('latest')], recentStart: 4999 })

    const props = captured.props as VirtuosoProps
    expect(props.defaultItemHeight).toBe(80)
  })

  it('does not render initial placeholders for an empty conversation', async () => {
    await render({ messages: [], recentStart: 0 })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(0)
    expect(props.initialItemCount).toBe(0)
    expect(props.initialTopMostItemIndex).toBe(0)
  })

  it('aligns navigation targets to the user-message start', async () => {
    await render({
      messages: [message('first'), message('second')],
      recentStart: 0,
      navigationItems: [
        { id: 'user-one', index: 0, promptPreview: 'First prompt' },
        { id: 'user-two', index: 1, promptPreview: 'Second prompt' }
      ]
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-navigation-entry="user-one"]')?.click()
    )

    expect(captured.scrollToIndex).toHaveBeenCalledWith({
      index: 0,
      align: 'start',
      behavior: 'smooth'
    })
    expect(
      container
        .querySelector<HTMLButtonElement>('[data-navigation-entry="user-one"]')
        ?.getAttribute('aria-current')
    ).toBe('true')
  })

  it('does not expose compaction messages or attach their responses to the previous prompt', async () => {
    vi.useFakeTimers()
    await render({
      messages: [
        userMessage('user-one', 'First prompt'),
        message('Before compaction'),
        {
          ...userMessage('compaction', 'Compacted context'),
          metadata: { compaction: true }
        },
        message('After compaction'),
        userMessage('user-two', 'Second prompt'),
        message('Second response')
      ],
      recentStart: 0
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-navigation-entry]')
    expect([...buttons].map((button) => button.dataset.navigationEntry)).toEqual([
      'user-one',
      'user-two'
    ])

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 64 }) as DOMRect
    rail.scrollTop = 0
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientY: 5 }))
      vi.advanceTimersByTime(150)
    })

    expect(document.body.textContent).toContain('Before compaction')
    expect(document.body.textContent).not.toContain('After compaction')
  })

  it('limits loaded hover previews instead of rendering an entire long response', async () => {
    vi.useFakeTimers()
    const response = `${'a'.repeat(2_000)}END`
    await render({
      messages: [
        userMessage('user-one', 'First prompt'),
        message(response),
        userMessage('user-two', 'Second prompt')
      ],
      recentStart: 0
    })

    const rail = container.querySelector<HTMLDivElement>('[aria-label="对话快速导航"]')!
    rail.getBoundingClientRect = () => ({ top: 0, left: 100, width: 32, height: 64 }) as DOMRect
    rail.scrollTop = 0
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientY: 5 }))
      vi.advanceTimersByTime(150)
    })

    expect(document.body.textContent).toContain('a'.repeat(100))
    expect(document.body.textContent).not.toContain('END')
  })

  it('prefetches pages before the oldest loaded message without exposing unloaded items', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      recentStart: 4999,
      onLoadRange
    })

    const props = captured.props as VirtuosoProps
    props.rangeChanged({ startIndex: 4999, endIndex: 4999 })

    expect(onLoadRange).toHaveBeenCalledOnce()
    expect(onLoadRange).toHaveBeenCalledWith(98, 99)
    expect(props.totalCount).toBe(1)
    expect(props.increaseViewportBy).toBe(400)
    expect(props.overscan).toBe(0)

    props.rangeChanged({ startIndex: 4999, endIndex: 4999 })
    expect(onLoadRange).toHaveBeenCalledTimes(2)
    expect(onLoadRange).toHaveBeenLastCalledWith(98, 99)
  })

  it('loads history before the first recent fragment when older messages exist', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      recentStart: 100,
      onLoadRange
    })

    ;(captured.props as VirtuosoProps).rangeChanged({ startIndex: 100, endIndex: 100 })

    expect(onLoadRange).toHaveBeenCalledWith(0, 1)
  })

  it('prefetches both sides of a disconnected target page while leaving the gap virtualized', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      recentStart: 4999,
      olderMessages: new Map([[100, message('loaded')]]),
      onLoadRange
    })

    ;(captured.props as VirtuosoProps).rangeChanged({ startIndex: 100, endIndex: 149 })
    expect(onLoadRange).toHaveBeenCalledOnce()
    expect((captured.props as VirtuosoProps).firstItemIndex).toBe(100)
    expect(onLoadRange).toHaveBeenCalledWith(1, 3)

    ;(captured.props as VirtuosoProps).rangeChanged({ startIndex: 150, endIndex: 199 })
    expect(onLoadRange).toHaveBeenLastCalledWith(2, 4)
  })

  it('builds navigation from loaded messages without scanning a disconnected index gap', async () => {
    const olderMessages = new Map([[100, userMessage('loaded-user', 'Loaded prompt')]])
    const read = olderMessages.get.bind(olderMessages)
    const get = vi.spyOn(olderMessages, 'get').mockImplementation((index) => {
      if (get.mock.calls.length > 20) throw new Error('scanned the unloaded history gap')
      return read(index)
    })

    await render({
      messages: [userMessage('latest-user', 'Latest prompt')],
      recentStart: 1_000_000,
      olderMessages
    })

    expect(get.mock.calls.length).toBeLessThanOrEqual(20)
    expect(container.querySelector('[data-navigation-entry="loaded-user"]')).not.toBeNull()
  })

  it('grows only when the agent appends a new message', async () => {
    const props = {
      messages: [message('latest')],
      recentStart: 4999
    }
    await render(props)
    expect((captured.props as VirtuosoProps).totalCount).toBe(1)

    await render({ ...props, messages: [...props.messages, message('appended')] })
    expect((captured.props as VirtuosoProps).totalCount).toBe(2)
  })

  it('re-renders a streaming message when the chat mutates its existing object', async () => {
    const streamingMessage = message('partial')
    const itemContainer = document.createElement('div')
    document.body.append(itemContainer)
    const itemRoot = createRoot(itemContainer)
    try {
      await render({ messages: [streamingMessage], recentStart: 0, live: true })
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))
      expect(itemContainer.textContent).toContain('partial')

      const textPart = streamingMessage.parts[0]
      if (textPart.type !== 'text') throw new Error('expected a text part')
      textPart.text = 'complete streamed text'
      await render({ messages: [streamingMessage], recentStart: 0, live: true })
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))

      expect(itemContainer.textContent).toContain('complete streamed text')
    } finally {
      await act(async () => itemRoot.unmount())
      itemContainer.remove()
    }
  })

  it('keeps all streaming content in processing and reveals final text after completion', async () => {
    const response = {
      id: 'multi-step-stream',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'I will inspect it.', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'read_file',
          toolCallId: 'read-1',
          state: 'output-available',
          input: { toolCallTitle: 'Read source' },
          output: 'done'
        },
        { type: 'step-start' },
        { type: 'reasoning', text: 'Reviewing the result', state: 'done' },
        { type: 'text', text: 'Current answer', state: 'streaming' }
      ]
    } as UIMessage

    await render({ messages: [response], recentStart: 0, live: true })

    const streaming = captured.props as VirtuosoProps
    expect(streaming.totalCount).toBe(1)
    expect(streaming.computeItemKey(0)).toBe('multi-step-stream-activity')
    expect(streaming.itemContent(0).props.children.props.renderItem).toEqual(
      expect.objectContaining({
        kind: 'activity-group',
        defaultOpen: true,
        partIndexes: [1, 2, 4, 5]
      })
    )

    const completed = {
      ...response,
      metadata: { startedAt: 1, completedAt: 2 },
      parts: response.parts.map((part) =>
        part.type === 'text' ? { ...part, state: 'done' as const } : part
      )
    } as UIMessage
    await render({ messages: [completed], recentStart: 0, live: false })

    const finished = captured.props as VirtuosoProps
    expect(finished.totalCount).toBe(2)
    expect(finished.computeItemKey(1)).toBe('multi-step-stream-5')
    expect(finished.itemContent(1).props.children.props.renderItem).toEqual(
      expect.objectContaining({ kind: 'final-text', partIndexes: [5] })
    )
    expect(finished.itemContent(1).props.children.props.replayFinal).toBe(true)
    expect(finished.itemContent(0).props.children.props.renderItem).toEqual(
      expect.objectContaining({ kind: 'activity-group', defaultOpen: false })
    )
  })

  it('does not enter final replay after an aborted response', async () => {
    const running = {
      id: 'aborted-stream',
      role: 'assistant',
      parts: [{ type: 'text', text: 'unfinished', state: 'streaming' }],
      metadata: { startedAt: 1 }
    } as UIMessage
    await render({ messages: [running], recentStart: 0, live: true })

    const aborted = {
      ...running,
      parts: [{ type: 'text', text: 'unfinished', state: 'done' }],
      metadata: { startedAt: 1, completedAt: 2, outcome: 'aborted' }
    } as UIMessage
    await render({ messages: [aborted], recentStart: 0, live: false })

    const finished = captured.props as VirtuosoProps
    expect(finished.totalCount).toBe(1)
    expect(finished.itemContent(0).props.children.props.replayFinal).toBe(false)
    expect(finished.itemContent(0).props.children.props.renderItem).toEqual(
      expect.objectContaining({ kind: 'activity-group' })
    )
  })

  it('waits for an assistant message before marking streaming content', async () => {
    const assistant = message('assistant')
    const user: UIMessage = {
      id: 'user',
      role: 'user',
      parts: [{ type: 'text', text: 'next request' }]
    }
    await render({ messages: [assistant, user], recentStart: 0, live: true })

    const props = captured.props as VirtuosoProps
    expect(props.itemContent(0).props.children.props.streaming).toBe(false)
    expect(props.itemContent(1).props.children.props.streaming).toBe(false)

    const response = message('response')
    await render({ messages: [assistant, user, response], recentStart: 0, live: true })
    const updated = captured.props as VirtuosoProps
    expect(updated.itemContent(0).props.children.props.streaming).toBe(false)
    expect(updated.itemContent(2).props.children.props.streaming).toBe(true)
  })

  it('resumes following after a tool output is submitted', async () => {
    const props = { messages: [message('latest')], recentStart: 0 }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, followRequest: 1 })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('scrolls to the bottom when a mounted conversation becomes active', async () => {
    await render({
      active: false,
      messages: [message('first')],
      recentStart: 0
    })
    captured.autoscrollToBottom.mockClear()
    await render({
      active: true,
      messages: [message('second-latest')],
      recentStart: 4999
    })

    expect(captured.mounts).toBe(1)
    expect((captured.props as VirtuosoProps).initialTopMostItemIndex).toEqual({
      index: 'LAST',
      align: 'end'
    })
    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
  })

  it('positions once and never re-positions when reactivated', async () => {
    // 列表保持挂载：切换会话时不卸装/重建，恢复时内容直接可见（无"先背景后内容"的闪烁）。
    const props = { messages: [message('latest')], recentStart: 0 }
    await render({ ...props, active: true })
    expect(captured.autoscrollToBottom).toHaveBeenCalledTimes(1)

    await render({ ...props, active: false })
    captured.autoscrollToBottom.mockClear()
    await render({ ...props, active: true })
    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
    expect(captured.mounts).toBe(1)
  })

  it('keeps the scroll position across conversation switches', async () => {
    // 用户切走前正在阅读历史中部：列表保持挂载，切回后滚动位置必须原样保留
    // （不能先跳底部、也不能因重建丢失位置）。
    const props = { messages: [message('latest')], recentStart: 0 }
    await render({ ...props, active: true })
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 77
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))

    await render({ ...props, active: false })
    await render({ ...props, active: true })

    expect(captured.mounts).toBe(1)
    expect(scroller.scrollTop).toBe(77)
    expect(container.firstElementChild?.getAttribute('style')).not.toContain('display: none')
  })

  it('keeps the mounted conversation hidden without rebuilding when inactive', async () => {
    await render({ active: false, messages: [message('hidden')], recentStart: 0 })

    expect(captured.mounts).toBe(1)
    expect(container.firstElementChild?.getAttribute('style')).toContain('display: none')
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })

  it('scrolls to the bottom when initial messages finish restoring', async () => {
    await render({
      messages: [],
      recentStart: 0
    })
    captured.autoscrollToBottom.mockClear()

    await render({
      messages: [message('latest')],
      recentStart: 4999
    })

    expect(captured.mounts).toBe(1)
    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
  })

  it('hides the return button while the initial location is being measured', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    expect(container.querySelector('button')).toBeNull()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    expect(container.querySelector('button')).toBeNull()
  })

  it('does not snap back to following when a navigation scroll moves up within the bottom tolerance', async () => {
    // 用户在最底部（following），点击导航上滑定位目标。scrollToIndex 启动上滑的瞬间仍接近底部，
    // 若 onScrollCapture 仅凭 distanceFromBottom<=threshold 就把 reading 切回 following，
    // 会被 followOutput/底部锚定拉回底部，表现为"点击导航上滑一点又反弹回底部，需多点几次"。
    // 修复：向上滚动（movedUp）时不恢复 following，只在用户向下滚回接近底部时恢复。
    await render({ messages: [message('latest')], recentStart: 0 })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))

    // 用户/导航进入 reading（阅读中的定位状态）：上滑意图
    act(() => container.firstElementChild?.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 })))

    // 模拟 scrollToIndex 一开始的上滑：scrollTop 100 -> 92（movedUp，distanceFromBottom = 8 <= 16）
    scroller.scrollTop = 92
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))

    // 不应恢复 following（无反弹），故 followOutput 不为 'auto'
    expect((captured.props as VirtuosoProps).followOutput(true)).toBe(false)
  })

  it('shows the return button only after the reader leaves the bottom tolerance', async () => {
    await render({ messages: [message('latest')], recentStart: 0 })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))

    scroller.scrollTop = 80
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    expect(container.querySelector('button')).toBeNull()

    scroller.scrollTop = 60
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    expect(container.querySelector('button')).not.toBeNull()

    scroller.scrollTop = 86
    act(() => scroller.dispatchEvent(new Event('scroll')))
    expect(container.querySelector('button')).toBeNull()
  })

  it('does not request historical pages when the conversation has no history', async () => {
    const onLoadRange = vi.fn()
    await render({
      messages: [message('latest')],
      recentStart: 0,
      onLoadRange
    })

    ;(captured.props as VirtuosoProps).rangeChanged({ startIndex: 0, endIndex: 0 })
    expect(onLoadRange).not.toHaveBeenCalled()
  })

  it('keeps following streaming growth when layout briefly reports away from bottom', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    captured.autoscrollToBottom.mockClear()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    await render({ ...props, messages: [...props.messages] })
    expect(captured.autoscrollToBottom).toHaveBeenCalled()

    captured.autoscrollToBottom.mockClear()
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    await render({ ...props, messages: [...props.messages] })
    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('pauses streaming follow after the reader scrolls upward', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [...props.messages] })

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('does not snap back before deferred scroll intent handling runs', async () => {
    await render({ messages: [message('latest')], recentStart: 0 })
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    captured.autoscrollToBottom.mockClear()

    act(() => container.firstElementChild?.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 })))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('immediately pauses follow on upward wheel input', async () => {
    await render({ messages: [message('latest')], recentStart: 0 })
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    act(() => container.firstElementChild?.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 })))
    captured.autoscrollToBottom.mockClear()

    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('keeps following when upward wheel input cannot move the outer scroller', async () => {
    const props = { messages: [message('streaming')], recentStart: 0, live: true }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(0)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))

    act(() => container.firstElementChild?.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 })))
    captured.autoscrollToBottom.mockClear()
    await render({ ...props, messages: [message('streaming longer')] })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
    expect(container.querySelector('button[aria-label="返回底部"]')).toBeNull()
  })

  it('pauses following after a small upward wheel movement', async () => {
    const props = { messages: [message('streaming')], recentStart: 0, live: true }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))

    act(() => container.firstElementChild?.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 })))
    scroller.scrollTop = 80
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [...props.messages] })

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
    expect(container.querySelector('button[aria-label="返回底部"]')).not.toBeNull()
  })

  it('cancels pending scroll intent when the conversation is hidden', async () => {
    const props = { messages: [message('streaming')], recentStart: 0, live: true }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))

    await render({ ...props, active: false })
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()
    await render({ ...props, active: true, messages: [message('streaming longer')] })

    // 保持挂载：切回不重建；仍处于流式跟随（following）时消息增长继续跟底。
    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('ignores scroll corrections while positioning the conversation', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const detach = content.props.ref(document.createElement('div'))
    act(() => resize())
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
    detach()
  })

  it('continues following when a growing message corrects the scroll position', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const detach = content.props.ref(document.createElement('div'))
    act(() => resize())
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [message('streaming longer')] })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
    detach()
  })

  it('lets an explicit upward wheel escape follow mode while the message is growing', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const detach = content.props.ref(document.createElement('div'))

    act(() => resize())
    act(() => container.firstElementChild?.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 })))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [message('streaming longer')] })
    act(() => resize())

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
    expect(container.querySelector('button[aria-label="返回底部"]')).not.toBeNull()
    detach()
  })

  it('follows asynchronous height growth inside the streaming message', async () => {
    await render({ messages: [message('streaming')], recentStart: 0, live: true })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const element = document.createElement('div')
    const detach = content.props.ref(element)
    captured.autoscrollToBottom.mockClear()

    act(() => resize())

    expect(scroller.scrollTop).toBe(scroller.scrollHeight)
    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
    detach()
  })

  it('keeps a completed activity open without following the bottom after virtualization remounts it', async () => {
    const completed = {
      id: 'completed-with-activity',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'checked the implementation', state: 'done' },
        { type: 'text', text: 'final answer', state: 'done' }
      ]
    } as UIMessage
    await render({ messages: [completed], recentStart: 0 })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))

    const itemContainer = document.createElement('div')
    const listContainer = document.createElement('div')
    const observedItem = document.createElement('div')
    const scroller = createScroller(100)
    listContainer.dataset.testid = 'virtuoso-item-list'
    listContainer.append(itemContainer, observedItem)
    scroller.append(listContainer)
    container.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    let itemRoot = createRoot(itemContainer)
    const lastContent = (captured.props as VirtuosoProps).itemContent(
      (captured.props as VirtuosoProps).totalCount - 1
    )
    const detach = lastContent.props.ref(observedItem)
    try {
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))
      await act(async () => itemContainer.querySelector<HTMLButtonElement>('button')?.click())

      expect((captured.props as VirtuosoProps).followOutput(true)).toBe(false)
      expect(itemContainer.querySelector('button')?.getAttribute('data-state')).toBe('open')

      // Expanding an item while initially at the bottom can make Virtuoso report
      // `atBottom` again before it measures the new height. That report must not
      // resume following and pull the expanded activity out of view.
      act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
      expect((captured.props as VirtuosoProps).followOutput(true)).toBe(false)
      expect(container.querySelector('button[aria-label="返回底部"]')).not.toBeNull()
      captured.autoscrollToBottom.mockClear()
      act(() => resize())
      expect(captured.autoscrollToBottom).not.toHaveBeenCalled()

      scroller.scrollTop = 190
      act(() => (captured.props as VirtuosoProps).totalListHeightChanged(300))
      await act(() => Promise.resolve())
      expect(scroller.scrollTop).toBe(100)

      await act(async () => itemRoot.unmount())
      itemRoot = createRoot(itemContainer)
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))

      expect(itemContainer.querySelector('button')?.getAttribute('data-state')).toBe('open')

      captured.autoscrollToBottom.mockClear()
      act(() =>
        container.querySelector<HTMLButtonElement>('button[aria-label="返回底部"]')?.click()
      )
      act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
      captured.autoscrollToBottom.mockClear()
      act(() => resize())

      expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
    } finally {
      detach()
      await act(async () => itemRoot.unmount())
      listContainer.remove()
    }
  })

  it('keeps a streaming activity collapsed after virtualization remounts it', async () => {
    const response = {
      id: 'streaming-with-activity',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'checking', state: 'done' },
        { type: 'text', text: 'current answer', state: 'streaming' }
      ]
    } as UIMessage
    await render({ messages: [response], recentStart: 0, live: true })

    const itemContainer = document.createElement('div')
    document.body.append(itemContainer)
    let itemRoot = createRoot(itemContainer)
    try {
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))
      expect(itemContainer.querySelector('button')?.getAttribute('data-state')).toBe('open')

      await act(async () => itemContainer.querySelector<HTMLButtonElement>('button')?.click())
      expect(itemContainer.querySelector('button')?.getAttribute('data-state')).toBe('closed')

      await render({
        messages: [
          {
            ...response,
            parts: [response.parts[0], { type: 'text', text: 'longer answer', state: 'streaming' }]
          } as UIMessage
        ],
        recentStart: 0,
        live: true
      })
      await act(async () => itemRoot.unmount())
      itemRoot = createRoot(itemContainer)
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))

      expect(itemContainer.querySelector('button')?.getAttribute('data-state')).toBe('closed')
    } finally {
      await act(async () => itemRoot.unmount())
      itemContainer.remove()
    }
  })

  it('keeps a manual activity preference while streaming text remains processing', async () => {
    const response = {
      id: 'reused-activity-key',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'checking', state: 'done' },
        { type: 'text', text: 'current answer', state: 'streaming' }
      ]
    } as UIMessage
    const itemContainer = document.createElement('div')
    document.body.append(itemContainer)
    const itemRoot = createRoot(itemContainer)
    try {
      await render({ messages: [response], recentStart: 0, live: true })
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))
      await act(async () => itemContainer.querySelector<HTMLButtonElement>('button')?.click())
      expect(itemContainer.querySelector('button')?.getAttribute('data-state')).toBe('closed')

      await render({
        messages: [
          {
            ...response,
            parts: [{ type: 'text', text: 'only current text', state: 'streaming' }]
          } as UIMessage
        ],
        recentStart: 0,
        live: true
      })
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))
      await render({ messages: [response], recentStart: 0, live: true })
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))

      expect(itemContainer.querySelector('button')?.getAttribute('data-state')).toBe('closed')
    } finally {
      await act(async () => itemRoot.unmount())
      itemContainer.remove()
    }
  })

  it('keeps observing a long final message with tool cards after streaming completes', async () => {
    const finalMessage = complexMessage()
    await render({ messages: [finalMessage], recentStart: 0, live: true })
    expect((captured.props as VirtuosoProps).totalCount).toBe(1)
    const lastIndex = (captured.props as VirtuosoProps).totalCount - 1
    const streamingContent = (captured.props as VirtuosoProps).itemContent(lastIndex)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const detach = streamingContent.props.ref(document.createElement('div'))

    await render({ messages: [finalMessage], recentStart: 0, live: false })
    expect((captured.props as VirtuosoProps).totalCount).toBe(2)
    const completedLastIndex = (captured.props as VirtuosoProps).totalCount - 1
    const completedContent = (captured.props as VirtuosoProps).itemContent(completedLastIndex)

    expect(streamingContent.props.ref).toEqual(expect.any(Function))
    expect(completedContent.props.ref).toBe(streamingContent.props.ref)
    captured.autoscrollToBottom.mockClear()
    act(() => resize())
    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
    detach()
  })

  it('does not follow height growth after the reader scrolls upward', async () => {
    await render({ messages: [message('streaming')], recentStart: 0, live: true })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const content = (captured.props as VirtuosoProps).itemContent(0)
    const detach = content.props.ref(document.createElement('div'))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 50
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()

    act(() => resize())

    expect(captured.autoscrollToBottom).not.toHaveBeenCalled()
    detach()
  })

  it('ignores scrolling and wheel input inside message-local scroll areas', async () => {
    const props = {
      messages: [message('streaming')],
      recentStart: 0,
      live: true
    }
    await render(props)
    const scroller = createScroller(100)
    const nestedScroller = document.createElement('div')
    nestedScroller.dataset.messageLocalScroll = ''
    scroller.append(nestedScroller)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    nestedScroller.scrollTop = 50
    act(() => {
      nestedScroller.dispatchEvent(new Event('scroll'))
      nestedScroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -20 }))
    })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(false))
    captured.autoscrollToBottom.mockClear()

    await render({ ...props, messages: [message('streaming longer')] })

    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('keeps growing content anchored to the bottom after the return button', async () => {
    const props = { messages: [message('latest')], recentStart: 0 }
    await render(props)
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 60
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="返回底部"]')?.click())
    expect(captured.autoscrollToBottom).toHaveBeenCalled()

    // 虚拟列表最后一帧高度未定/后续消息追加时，必须继续跟随到底，
    // 否则滑块会停在半路（用户报告的"点了回到底部却不到底"）。
    expect((captured.props as VirtuosoProps).followOutput(true)).toBe('auto')

    await render({ ...props, messages: [message('latest even longer')] })
    expect(captured.autoscrollToBottom).toHaveBeenCalled()
  })

  it('returns to the true bottom after initial positioning', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })
    act(() => (captured.props as VirtuosoProps).atBottomStateChange(true))
    const scroller = createScroller(100)
    container.firstElementChild?.append(scroller)
    act(() => (captured.props as VirtuosoProps).scrollerRef(scroller))
    scroller.scrollTop = 60
    act(() => scroller.dispatchEvent(new Event('scroll')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)))
    captured.autoscrollToBottom.mockClear()
    act(() => container.querySelector<HTMLButtonElement>('button')?.click())

    expect(captured.autoscrollToBottom).toHaveBeenCalledOnce()
  })

  it('keeps unloaded items at the configured estimated height', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 4999
    })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(100)))
    expect(container.querySelector<HTMLElement>('[data-scroll-placeholder]')?.style.height).toBe(
      '80px'
    )
    expect(container.querySelector('[data-scroll-placeholder]')?.childElementCount).toBe(2)
    expect(container.firstElementChild?.getAttribute('data-message-index')).toBe('100')
  })

  it('marks rendered messages as viewport anchor candidates', async () => {
    await render({ messages: [message('latest')], recentStart: 0 })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(0)))
    expect(container.firstElementChild?.getAttribute('data-message-index')).toBe('0')
  })

  it('visually joins consecutive assistant messages without merging their data', async () => {
    const user: UIMessage = {
      id: 'user',
      role: 'user',
      parts: [{ type: 'text', text: 'next request' }]
    }
    await render({
      messages: [message('first'), message('second'), user],
      recentStart: 0
    })

    const props = captured.props as VirtuosoProps
    expect(props.itemContent(0).props.className).toContain('pb-0')
    expect(props.itemContent(1).props.className).toContain('pt-0')
    expect(props.itemContent(1).props.className).toContain('pb-3')
    expect(props.itemContent(2).props.className).toContain('pt-3')
    expect(props.computeItemKey(0)).toBe('first-0')
    expect(props.computeItemKey(1)).toBe('second-0')
  })

  it('labels an interrupted activity history as aborted', async () => {
    const response = {
      id: 'aborted-history',
      role: 'assistant',
      metadata: { outcome: 'aborted' },
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'aborted-progress',
          state: 'output-available',
          input: { title: '检查实现' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: 'interrupted work', state: 'done' }
      ]
    } as UIMessage

    await render({ messages: [response], recentStart: 0, live: false })
    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(0)))

    expect(container.textContent).toContain('已中断')
    expect(container.textContent).not.toContain('处理过程')
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-activity-history] > button')?.click()
    )
    expect(container.querySelectorAll('[data-stage-status="completed"]')).toHaveLength(1)
  })

  it('keeps a manually expanded stage open after virtualization remounts the history', async () => {
    // 用户报告：流式进行到第二个进度项时，点击第一个（已完成）进度项会展开又立即被收起。
    // 根因是内层 stage 的展开状态未持久化到 openActivities，虚拟列表回收重挂载后弹回折叠。
    // 此测试在真实 message-list 全链路下复现并验证修复：点击已完成 stage → 触发清理 →
    // remount，stage 仍应保持展开。
    const response = {
      id: 'two-stage-history',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'progress-one',
          state: 'output-available',
          input: { title: '调研' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: '调研现有实现', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'fs_read',
          toolCallId: 'read-1',
          state: 'output-available',
          input: { toolCallTitle: '读取现有实现' },
          output: 'done'
        },
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'progress-two',
          state: 'output-available',
          input: { title: '实现' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: '修改功能实现', state: 'streaming' }
      ]
    } as UIMessage

    await render({ messages: [response], recentStart: 0, live: true })

    const itemContainer = document.createElement('div')
    document.body.append(itemContainer)
    let itemRoot = createRoot(itemContainer)
    try {
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))

      // 找到内层已完成 stage（'调研'）的按钮，它默认折叠
      const stageButton = [...itemContainer.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === '调研'
      )
      expect(stageButton).toBeTruthy()
      expect(stageButton?.getAttribute('data-state')).toBe('closed')

      // 点击已完成 stage 展开
      await act(async () => stageButton?.click())
      expect(
        [...itemContainer.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent?.trim() === '调研'
        )?.getAttribute('data-state')
      ).toBe('open')

      // 触发消息更新（recentItems 重建，清理 openActivities 的 effect 会运行）
      await render({
        messages: [
          {
            ...response,
            parts: [...response.parts, { type: 'text', text: '最终答案', state: 'streaming' }]
          } as UIMessage
        ],
        recentStart: 0,
        live: true
      })

      // 虚拟列表回收后重挂载同一行
      await act(async () => itemRoot.unmount())
      itemRoot = createRoot(itemContainer)
      await act(async () => itemRoot.render((captured.props as VirtuosoProps).itemContent(0)))

      // 关键：重挂载后，用户手动展开的已完成 stage 仍应保持展开（而非弹回折叠）
      expect(
        [...itemContainer.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent?.trim() === '调研'
        )?.getAttribute('data-state')
      ).toBe('open')
    } finally {
      await act(async () => itemRoot.unmount())
      itemContainer.remove()
    }
  })

  it('keeps an activity history expanded while ask user waits for an answer', async () => {
    const response = {
      id: 'waiting-history',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'waiting-progress',
          state: 'output-available',
          input: { title: '等待分析' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: '需要您选择', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'ask-option',
          state: 'input-available',
          input: { toolCallTitle: '请选择' }
        }
      ]
    } as UIMessage

    await render({ messages: [response], recentStart: 0, live: false })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(1)
    expect(props.computeItemKey(0)).toBe('waiting-history-activity-history')
    const fragment = props.itemContent(0).props.children
    const history = fragment.props.children[0]
    expect(history.props.waiting).toBe(true)
    expect(history.props.sections.map(({ title }) => title)).toEqual(['等待分析'])

    await act(async () => root.render(props.itemContent(0)))
    expect(container.textContent).toContain('等待回答')
    expect(container.textContent).not.toContain('已完成')
    expect(
      container.querySelector<HTMLButtonElement>('[data-activity-history] > button')?.dataset.state
    ).toBe('open')
  })

  it('expands every stage group while ask user waits (waiting not only streaming)', async () => {
    // 用户报告：ask_user 等待回答时，跨阶段 activity-history 的进度组（如「调研会话前进后退功能」）
    // 被折叠成标题行。修复后 waiting 时进度组应默认展开（defaultOpen = streaming || waiting）。
    const response = {
      id: 'waiting-click-stage',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'stage-progress',
          state: 'output-available',
          input: { title: '调研会话前进后退功能' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: '分析当前实现', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'agent_ask_user',
          toolCallId: 'ask-option',
          state: 'input-available',
          input: { toolCallTitle: '确认推荐方向' }
        }
      ]
    } as UIMessage

    await render({ messages: [response], recentStart: 0, live: false })

    const props = captured.props as VirtuosoProps
    expect(props.computeItemKey(0)).toBe('waiting-click-stage-activity-history')

    await act(async () => root.render(props.itemContent(0)))

    // 顶层 activity history 因 waiting 展开
    const historyTrigger = container.querySelector<HTMLButtonElement>(
      '[data-activity-history] > button'
    )
    expect(historyTrigger?.dataset.state).toBe('open')

    // 进度组（stage 的 ActivityGroupPart）因 waiting 默认展开（而非仅 streaming 时）
    const stageTriggers = container.querySelectorAll<HTMLButtonElement>(
      '[data-activity-group] > button'
    )
    expect(stageTriggers.length).toBeGreaterThan(0)
    const stageTrigger = [...stageTriggers].find((b) =>
      b.textContent?.includes('调研会话前进后退功能')
    )
    expect(stageTrigger).toBeTruthy()
    expect(stageTrigger?.dataset.state).toBe('open')
  })

  it('starts named stages before work with show progress independently of reset', async () => {
    const response = {
      id: 'progress-before-work',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'progress-one',
          state: 'output-available',
          input: { title: '列出当前目录' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: 'stage one work', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'agent_reset_context',
          toolCallId: 'context-only-reset',
          state: 'output-available',
          input: { handoff: 'Continue.' },
          output: 'Context reset requested.'
        },
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'progress-two',
          state: 'output-available',
          input: { title: '读取 package.json' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: 'stage two work', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: 'duplicate-progress-two',
          state: 'output-available',
          input: { title: '读取 package.json' },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: 'more stage two work', state: 'done' }
      ]
    } as UIMessage

    const switching = { ...response, parts: response.parts.slice(0, 4) } as UIMessage
    await render({ messages: [switching], recentStart: 0, live: true })

    let props = captured.props as VirtuosoProps
    let content = props.itemContent(0).props.children
    let history = content.props.sections ? content : content.props.children[0]
    expect(history.props.sections.map(({ title }) => title)).toEqual(['列出当前目录'])
    expect(history.props.sections[0].streaming).toBe(true)

    await render({ messages: [response], recentStart: 0, live: true })

    props = captured.props as VirtuosoProps
    content = props.itemContent(0).props.children
    history = content.props.sections ? content : content.props.children[0]
    expect(history.props.sections.map(({ title }) => title)).toEqual([
      '列出当前目录',
      '读取 package.json'
    ])
    // reset_context 也从隐藏变为可见工具卡片，故纳入其所在 stage（'列出当前目录'）的 partIndexes。
    expect(history.props.sections[0].item.partIndexes).toEqual([1, 2])
    expect(history.props.sections[1].item.partIndexes).toEqual([4])
    expect(history.props.sections[1].continuations).toHaveLength(1)
    expect(history.props.sections[1].continuations[0].item.partIndexes).toEqual([6])
  })

  it('keeps progress stages together across the historical and recent boundary', async () => {
    const stage = (id: string, title: string, additions: number): UIMessage => ({
      id,
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'agent_show_progress',
          toolCallId: `progress-${id}`,
          state: 'output-available',
          input: { title },
          output: 'Progress shown.'
        },
        { type: 'reasoning', text: `${id} work`, state: 'done' },
        {
          type: 'data-git-snapshot',
          data: {
            files: [
              {
                path: 'task.md',
                additions,
                deletions: 0,
                patch: '@@ -0,0 +1 @@\n+stage'
              }
            ]
          }
        }
      ]
    })

    await render({
      messages: [stage('recent-stage', '实现', 2)],
      recentStart: 1,
      olderMessages: new Map([[0, stage('historical-stage', '调研', 1)]])
    })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(1)
    expect(props.computeItemKey(0)).toBe('historical-stage-activity-history')
    const fragment = props.itemContent(0).props.children
    const history = fragment.props.children[0]
    expect(history.props.sections.map(({ title }) => title)).toEqual(['调研', '实现'])
    expect(fragment.props.children[1][0].props.children.props.additions).toBe(2)
  })

  it('renders reset context as a normal tool card without treating its title as a stage', async () => {
    const response = {
      id: 'legacy-reset-stage',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'legacy work', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'agent_reset_context',
          toolCallId: 'legacy-reset',
          state: 'output-available',
          input: { toolCallTitle: '切换上下文', title: '旧阶段', handoff: 'Continue.' },
          output: 'Context reset requested.'
        }
      ]
    } as UIMessage

    await render({ messages: [response], recentStart: 0 })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(1)
    // reset_context 现在作为可见工具卡片渲染（含其自身 part），不再被 hidden。
    expect(props.itemContent(0).props.children.props.renderItem.partIndexes).toEqual([0, 1])
  })

  it('keeps the live changes card after every renderable response fragment', async () => {
    const response = {
      id: 'response-with-changes',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'before edit' },
        {
          type: 'data-git-snapshot',
          data: {
            root: 'D:\\repo',
            files: [
              {
                additions: 1,
                deletions: 0,
                patch: '+change',
                path: 'file.ts'
              }
            ]
          }
        },
        { type: 'text', text: 'streaming after edit' }
      ]
    } as UIMessage
    await render({ messages: [response], recentStart: 0, live: true })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(2)
    expect(props.itemContent(0).props.children.props.renderItem.partIndexes).toEqual([0, 2])
    expect(props.itemContent(1).props.children.props.files[0].path).toBe('file.ts')
    expect(props.itemContent(1).props.className).toContain('pt-4')
    expect(props.itemContent(0).props.className).toContain('[contain:layout_paint_style]')
    expect(props.itemContent(1).props.className).not.toContain('[contain:layout_paint_style]')
  })

  it('keeps existing fragment keys stable when output continues after a change', async () => {
    const snapshot = {
      type: 'data-git-snapshot',
      data: {
        files: [{ additions: 1, deletions: 0, patch: '+change', path: 'file.ts' }]
      }
    }
    const response = {
      id: 'stable-response',
      role: 'assistant',
      parts: [{ type: 'text', text: 'before edit' }, snapshot]
    } as UIMessage
    await render({ messages: [response], recentStart: 0, live: true })
    expect((captured.props as VirtuosoProps).computeItemKey(0)).toBe('stable-response-activity')

    await render({
      messages: [
        {
          ...response,
          parts: [...response.parts, { type: 'text', text: 'after edit' }]
        } as UIMessage
      ],
      recentStart: 0,
      live: true
    })

    const props = captured.props as VirtuosoProps
    expect(props.computeItemKey(0)).toBe('stable-response-activity')
    expect(props.computeItemKey(1)).toBe('stable-response-changes')
  })

  it('does not replace long streamed output above a changes card when streaming completes', async () => {
    const text = Array.from(
      { length: 12 },
      (_, index) => `## Section ${index}\n\n${`paragraph-${index} `.repeat(80)}`
    ).join('\n\n')
    const response = {
      id: 'long-streamed-response',
      role: 'assistant',
      parts: [
        { type: 'text', text, state: 'streaming' },
        {
          type: 'data-git-snapshot',
          data: {
            files: [{ additions: 1, deletions: 0, patch: '+change', path: 'file.ts' }]
          }
        }
      ]
    } as UIMessage

    await render({ messages: [response], recentStart: 0, live: true })
    const liveProps = captured.props as VirtuosoProps
    expect(liveProps.totalCount).toBe(2)
    expect(liveProps.computeItemKey(0)).toBe('long-streamed-response-activity')

    await render({
      messages: [
        {
          ...response,
          parts: [{ type: 'text', text, state: 'done' }, response.parts[1]]
        } as UIMessage
      ],
      recentStart: 0,
      live: false
    })

    const completedProps = captured.props as VirtuosoProps
    expect(completedProps.totalCount).toBe(2)
    expect(completedProps.computeItemKey(0)).toBe('long-streamed-response-0')
  })

  it('renders a snapshot-only response as one changes item without an empty message item', async () => {
    await render({
      messages: [
        {
          id: 'snapshot-only',
          role: 'assistant',
          parts: [
            {
              type: 'data-git-snapshot',
              data: {
                files: [{ additions: 1, deletions: 0, patch: '+change', path: 'file.ts' }]
              }
            }
          ]
        } as UIMessage
      ],
      recentStart: 0
    })

    const props = captured.props as VirtuosoProps
    expect(props.totalCount).toBe(1)
    expect(props.computeItemKey(0)).toBe('snapshot-only-changes')
  })

  it('reserves the rounded composer overlap without shifting the message column', async () => {
    await render({
      messages: [message('latest')],
      recentStart: 0
    })

    await act(async () => root.render((captured.props as VirtuosoProps).itemContent(0)))
    expect(container.firstElementChild?.className).toContain('pb-30')
    expect(container.firstElementChild?.className).toContain('w-full')
    expect(container.firstElementChild?.className).not.toContain('translate-x-')
    expect(container.firstElementChild?.className).not.toContain(
      'w-[calc(100%-var(--larify-scrollbar-size))]'
    )
  })
})

async function render({
  active = true,
  messages,
  recentStart,
  live = false,
  followRequest = 0,
  olderMessages = new Map(),
  navigationItems = [],
  onLoadRange = vi.fn()
}: {
  active?: boolean
  messages: UIMessage[]
  recentStart: number
  live?: boolean
  followRequest?: number
  olderMessages?: Map<number, UIMessage>
  navigationItems?: Array<{
    id: string
    index: number
    promptPreview: string
    responsePreview?: string
  }>
  onLoadRange?: (firstPage: number, lastPage: number) => void
}): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AssistantMessageList, {
        active,
        messages,
        live,
        followRequest,
        recentStart,
        olderMessages,
        navigationItems,
        onLoadRange
      })
    )
  )
}

function message(id: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text: id }] }
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

function complexMessage(): UIMessage {
  return {
    id: 'long-final-message',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'long text '.repeat(2000) },
      {
        type: 'dynamic-tool',
        toolName: 'browser_screenshot',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { toolCallTitle: '截取完整页面' },
        output: { path: 'page.png' }
      },
      {
        type: 'dynamic-tool',
        toolName: 'browser_pdf',
        toolCallId: 'call-2',
        state: 'output-available',
        input: { toolCallTitle: '保存页面为 PDF' },
        output: { path: 'page.pdf' }
      },
      { type: 'text', text: '| 文件 | 大小 |\n| --- | ---: |\n| page.png | 26007 |' }
    ]
  }
}

function createScroller(scrollTop: number): HTMLDivElement {
  const scroller = document.createElement('div')
  Object.defineProperties(scroller, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 200 }
  })
  scroller.scrollTop = scrollTop
  return scroller
}
