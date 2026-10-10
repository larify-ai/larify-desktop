// @vitest-environment jsdom
/**
 * 守门：reset 边界的 **live-state 超集副本**（用户现场会话 `80f2439a`）。
 *
 * 主进程在 reset 边界发出**第二个 `start` chunk 且换新 id**（落库 `resetStoredId`，为让续写产出
 * 落在 `sessions.start` 之后、模型可读），而 AI SDK 客户端 `case "start"` **只覆盖 id、不重置
 * `parts`** ⇒ 渲染端那条被 push 出来的消息**仍带 reset 前全部 parts**（超集副本）⇒ 同名 stage
 * 出现 3 次（重载只有 2 次）。修复 = 渲染前折叠「相邻 assistant 超集副本」（见
 * `assistant-copy-dedupe.ts`）：只改显示、不动数据。
 *
 * 本文件锁三件事：
 * 1. 纯函数 `dedupeAssistantCopies` 的折叠判据：**对称**（谁被另一条严格包含就丢谁）、
 *    两条护栏（① 被丢行不含在途 part；② 被丢行不是渲染端末端）、不误杀（跨真实用户消息保守、
 *    非前缀包含不折、内容不同的 reasoning/text 不误判）。
 * 2. 真实 `AssistantMessageList` 全链路下 **live（副本）与重载（DB 两条独立行）渲染结果一致**
 *    —— 红基线：live 得到 3 个同名 section；修复后 2 个。
 * 3. 折叠后 live 只渲染一条 activity-history（不残留 reset 前的独立行）。
 */
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
      getState: (callback: (snapshot: unknown) => void) =>
        callback({ ranges: [{ startIndex: 0, endIndex: 0, size: 320 }], scrollTop: 0 })
    }))
    return null
  })
}))

import { dedupeAssistantCopies } from '../../../src/renderer/src/app/interaction/assistant/assistant-copy-dedupe'
import { AssistantMessageList } from '../../../src/renderer/src/app/interaction/assistant/message-list'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const STAGE_TITLE = '第六轮 review：深挖剩余隐患（SBUS 失效位/模块清理/格式）'

function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

function assistant(id: string, parts: UIMessage['parts']): UIMessage {
  return { id, role: 'assistant', parts }
}

function progress(id: string, title: string): UIMessage['parts'][number] {
  return {
    type: 'dynamic-tool',
    toolName: 'agent_show_progress',
    toolCallId: id,
    state: 'output-available',
    input: { title },
    output: 'Progress shown.'
  }
}

function resetPart(id: string): UIMessage['parts'][number] {
  return {
    type: 'dynamic-tool',
    toolName: 'agent_reset_context',
    toolCallId: id,
    state: 'output-available',
    input: { handoff: 'Continue.' },
    output: 'Context reset requested.'
  }
}

/** reset 前那一段（末尾是 reset part）。 */
function preResetParts(): UIMessage['parts'] {
  return [
    { type: 'step-start' },
    { type: 'text', text: 'PRE_RESET_WORK', state: 'done' },
    progress('p-pre', STAGE_TITLE),
    resetPart('r-1')
  ]
}

/** reset 后的增量段。 */
function postResetParts(): UIMessage['parts'] {
  return [
    { type: 'step-start' },
    { type: 'text', text: 'POST_RESET_WORK', state: 'done' },
    progress('p-post', STAGE_TITLE),
    { type: 'text', text: 'POST_RESET_TAIL', state: 'done' }
  ]
}

describe('dedupeAssistantCopies', () => {
  it('丢弃「以前一条 parts 为前缀」的超集副本，只留最后一条', () => {
    const source = assistant('a', preResetParts())
    const copy = assistant('b', [...preResetParts(), ...postResetParts()])
    const result = dedupeAssistantCopies([source, copy])
    expect(result.map((message) => message.id)).toEqual(['b'])
  })

  it('不误杀「相邻但非前缀超集」的两条回复', () => {
    const first = assistant('a', [{ type: 'text', text: 'one' }])
    const second = assistant('b', [{ type: 'text', text: 'two' }])
    expect(dedupeAssistantCopies([first, second])).toHaveLength(2)
  })

  it('跨真实用户消息不折叠（每一轮各自保留）', () => {
    const first = assistant('a', [{ type: 'text', text: 'same' }])
    const second = assistant('b', [
      { type: 'text', text: 'same' },
      { type: 'text', text: 'more' }
    ])
    const result = dedupeAssistantCopies([first, userMessage('u', 'next'), second])
    expect(result.map((message) => message.id)).toEqual(['a', 'u', 'b'])
  })

  it('跨 compaction（handoff）行仍折叠：reset 续写的两条同属一条 UI 消息', () => {
    const source = assistant('a', [{ type: 'text', text: 'same' }])
    const handoff: UIMessage = {
      ...userMessage('h', '# Handoff'),
      metadata: { compaction: true }
    }
    const copy = assistant('b', [
      { type: 'text', text: 'same' },
      { type: 'text', text: 'more' }
    ])
    const result = dedupeAssistantCopies([source, handoff, copy])
    expect(result.map((message) => message.id)).toEqual(['h', 'b'])
  })

  it('超集链只保留最后一条（A ⊂ B ⊂ C ⇒ 丢 A、B）', () => {
    const a = assistant('a', [{ type: 'text', text: 'x' }])
    const b = assistant('b', [
      { type: 'text', text: 'x' },
      { type: 'text', text: 'y' }
    ])
    const c = assistant('c', [
      { type: 'text', text: 'x' },
      { type: 'text', text: 'y' },
      { type: 'text', text: 'z' }
    ])
    expect(dedupeAssistantCopies([a, b, c]).map((message) => message.id)).toEqual(['c'])
  })

  it('user 行与空 parts 不受影响', () => {
    const empty = assistant('empty', [])
    const withText = assistant('text', [{ type: 'text', text: 'x' }])
    const result = dedupeAssistantCopies([userMessage('u', 'hi'), empty, withText])
    expect(result.map((message) => message.id)).toEqual(['u', 'empty', 'text'])
  })

  it('不误杀「同为 reasoning/text、仅内容不同」的相邻轮次', () => {
    // 回归：签名若只按 `type`，两条不同内容的 reasoning（或 text）会被判成同一 part；
    // 实测误杀 nest 轮：主链 `[reasoning 'main work']` 被当成子轮 `[reasoning 'nested work']`
    // 的前缀超集而丢弃（tests/renderer 的跨 compaction 聚合用例红）。
    const main = assistant('main', [{ type: 'reasoning', text: 'main work' }])
    const nested = assistant('nested', [{ type: 'reasoning', text: 'nested work' }])
    expect(dedupeAssistantCopies([main, nested]).map((message) => message.id)).toEqual([
      'main',
      'nested'
    ])

    const first = assistant('t1', [{ type: 'text', text: 'alpha' }])
    const second = assistant('t2', [{ type: 'text', text: 'beta' }])
    expect(dedupeAssistantCopies([first, second])).toHaveLength(2)
  })

  it('无副本时返回原数组引用（避免无谓重建）', () => {
    const messages = [userMessage('u', 'hi'), assistant('a', [{ type: 'text', text: 'x' }])]
    expect(dedupeAssistantCopies(messages)).toBe(messages)
  })

  it('反向复制也折：后条 parts 是前条严格前缀 ⇒ 丢后条、留前条', () => {
    // B 类：长行是「活着的那条」（内容与在途 ask 都在它上面），短行是陈旧副本。
    const long = assistant('long', preResetParts())
    const stale = assistant('stale', [
      { type: 'step-start' },
      { type: 'text', text: 'PRE_RESET_WORK' }
    ])
    const result = dedupeAssistantCopies([long, stale])
    expect(result.map((message) => message.id)).toEqual(['long'])
  })

  it('护栏①：后条虽被包含，但含在途（ask_user 待答）part ⇒ 不折', () => {
    const long = assistant('long', [
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'agent_ask_user',
        toolCallId: 'ask-1',
        state: 'output-available',
        input: { question: 'Q' },
        output: 'A'
      },
      { type: 'text', text: 'AFTER_ASK', state: 'done' }
    ])
    const awaiting = assistant('awaiting', [
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'agent_ask_user',
        toolCallId: 'ask-1',
        state: 'input-available',
        input: { question: 'Q' }
      }
    ])
    // 同一行要么两向都保留（前条含它、它是「在等回答」的那条）。
    expect(dedupeAssistantCopies([long, awaiting]).map((m) => m.id)).toEqual(['long', 'awaiting'])
  })

  it('护栏①只作用于 B 分支：A 分支（丢前条）不受在途 part 影响', () => {
    const awaiting = assistant('awaiting', [
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'agent_ask_user',
        toolCallId: 'ask-1',
        state: 'input-available',
        input: { question: 'Q' }
      }
    ])
    const copy = assistant('copy', [
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'agent_ask_user',
        toolCallId: 'ask-1',
        state: 'output-available',
        input: { question: 'Q' },
        output: 'A'
      }
    ])
    // 前条被后条包含 ⇒ 丢前条（它的在途 part 在保留行里有同 toolCallId 的终态版本）。
    expect(dedupeAssistantCopies([awaiting, copy]).map((m) => m.id)).toEqual(['copy'])
  })

  it('护栏②：渲染端末端（renderTailId）即使被包含也不折', () => {
    const long = assistant('long', preResetParts())
    const stale = assistant('stale', [
      { type: 'step-start' },
      { type: 'text', text: 'PRE_RESET_WORK' }
    ])
    // 无护栏 ⇒ 丢后条（stale）。
    expect(dedupeAssistantCopies([long, stale]).map((m) => m.id)).toEqual(['long'])
    // 末端护栏生效 ⇒ 两条都留。
    expect(dedupeAssistantCopies([long, stale], 'stale').map((m) => m.id)).toEqual([
      'long',
      'stale'
    ])
  })
})

let container: HTMLDivElement
let root: Root

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function render(messages: UIMessage[], live: boolean): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AssistantMessageList, {
        active: true,
        messages,
        live,
        followRequest: 0,
        recentStart: 0,
        olderMessages: new Map<number, UIMessage>(),
        navigationItems: [],
        onLoadRange: vi.fn()
      })
    )
  )
}

interface VirtuosoProps {
  totalCount: number
  itemContent(index: number): { props: { children: unknown } }
}

/** 取出 activity-history item 的 stage 标题序列（经真实渲染链路，扫描全部 item）。 */
function stageSectionTitles(): string[] {
  const props = captured.props as VirtuosoProps
  for (let index = 0; index < props.totalCount; index += 1) {
    const content = props.itemContent(index).props.children as {
      props?: { sections?: Array<{ title: string }>; children?: unknown }
    }
    const direct = content.props
    if (direct?.sections) return direct.sections.map((section) => section.title)
    const child = (
      direct?.children as Array<{ props?: { sections?: Array<{ title: string }> } }> | undefined
    )?.[0]
    if (child?.props?.sections) return child.props.sections.map((section) => section.title)
  }
  return []
}

describe('reset 边界的 live 副本（真实 AssistantMessageList）', () => {
  it('live（超集副本）与重载（DB 两条独立行）渲染出相同数量的同名 stage', async () => {
    const question = userMessage('u-1', 'review 下所有代码')

    // 重载：库里两条独立行（reset 前 + reset 后），**没有**超集关系。
    const reloadMessages = [
      question,
      assistant('row-pre', preResetParts()),
      assistant('row-post', postResetParts())
    ]
    // live：reset 边界被 AI SDK `pushMessage` 出的副本——parts = reset 前全部 + reset 后增量。
    const liveMessages = [
      question,
      assistant('row-pre', preResetParts()),
      assistant('row-live-copy', [...preResetParts(), ...postResetParts()])
    ]

    await render(reloadMessages, false)
    const reloadTitles = stageSectionTitles()

    await render(liveMessages, true)
    const liveTitles = stageSectionTitles()

    // 修复前：live 会得到 3 个 section（前段 + 副本里的前段 + 后段）⇒ 用户截图里的「同名 3 次」。
    // 修复后：live 折叠掉超集副本中的前段 ⇒ 与重载一致（2 个同名 stage：1 个已完成 + 1 个运行中）。
    expect(liveTitles).toEqual([STAGE_TITLE, STAGE_TITLE])
    expect(liveTitles).toEqual(reloadTitles)
  })

  it('折叠后 live 只渲染一条 activity-history（不残留 reset 前的独立行）', async () => {
    await render(
      [
        userMessage('u-1', 'review 下所有代码'),
        assistant('row-pre', preResetParts()),
        assistant('row-live-copy', [...preResetParts(), ...postResetParts()])
      ],
      true
    )
    // 用户消息 + 一张聚合卡（而非两张：reset 前独立行 + 副本）。
    expect((captured.props as VirtuosoProps).totalCount).toBe(2)
  })
})
