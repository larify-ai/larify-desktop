// @vitest-environment jsdom
//
// 守门：完成瞬间（live true→false）若滚动意图不是 reading，必须贴底跟随，
// 否则本轮答复（完成时才以打字机长高）会落在视口下方 —— 用户报「已完成但看不到回复」。
// 复现：让 scrollMode 停在 positioning（模拟 Virtuoso 未判到底），完成时内容长高，断言贴底。

import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

const captured = vi.hoisted(() => ({ props: undefined as unknown }))
vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function Virtuoso(props: unknown, ref) {
    captured.props = props
    useImperativeHandle(ref, () => ({
      autoscrollToBottom: vi.fn(),
      scrollToIndex: vi.fn(),
      getState: vi.fn()
    }))
    return null
  })
}))

import { AssistantMessageList } from '../../../src/renderer/src/app/interaction/assistant/message-list'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface V {
  totalCount: number
  itemContent(i: number): React.JSX.Element
  computeItemKey(i: number): React.Key
  scrollerRef(e: unknown): void
  atBottomStateChange(b: boolean): void
  followOutput(b: boolean): unknown
  totalListHeightChanged(h: number): void
}

let container: HTMLDivElement
let root: Root
const H = new WeakMap<HTMLElement, number>()
function scrollerEl(initialH: number, clientH: number): HTMLDivElement {
  const el = document.createElement('div')
  H.set(el, initialH)
  Object.defineProperties(el, {
    clientHeight: { value: clientH },
    scrollHeight: { configurable: true, get: () => H.get(el) ?? initialH }
  })
  el.scrollTop = initialH - clientH
  return el
}

const turn = (state: 'streaming' | 'done'): UIMessage =>
  ({
    id: 'a1',
    role: 'assistant',
    metadata:
      state === 'done'
        ? { startedAt: 1, completedAt: 2, totalProcessingMs: 1000, finishReason: 'stop' }
        : { startedAt: 1, totalProcessingMs: 1000 },
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'agent_show_progress',
        toolCallId: 'p',
        state: 'output-available',
        input: { title: 'x' },
        output: 'ok'
      },
      { type: 'step-start' },
      { type: 'text', text: '正文'.repeat(300), state }
    ]
  }) as unknown as UIMessage
const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'q' }] }

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(live: boolean, msg: UIMessage): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AssistantMessageList, {
        active: true,
        messages: [user, msg],
        live,
        followRequest: 0,
        recentStart: 0,
        olderMessages: new Map(),
        navigationItems: [],
        onLoadRange: vi.fn()
      })
    )
  )
}
async function flush(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1)
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
}

describe('completion sticks to bottom', () => {
  it('完成时即使在 positioning 模式，也会贴底跟随（正文不落在视口下方）', async () => {
    await render(true, turn('streaming'))
    const el = scrollerEl(1500, 600)
    container.firstElementChild?.append(el)
    act(() => (captured.props as V).scrollerRef(el))
    // 故意不调用 atBottomStateChange(true)：scrollMode 停在 positioning
    expect((captured.props as V).followOutput(true)).toBe(false)

    // 完成：正文逐字长高（模拟打字机）
    await render(false, turn('done'))
    H.set(el, 2000)
    await flush(40)

    // 断言：视口已贴到底（修复前停在 900，离底 500）
    expect(el.scrollHeight - el.clientHeight - el.scrollTop).toBeLessThanOrEqual(1)
  })
})
