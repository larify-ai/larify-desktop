// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  activityGroupPropsEqual,
  outputSize,
  renderItemContentEquals,
  type ActivityGroupPartProps
} from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/activity-group-memo'
import type { AssistantRenderItem } from '../../../../../src/renderer/src/app/interaction/assistant/message-render-items'

function toolGroupItem(overrides: Partial<AssistantRenderItem> = {}): AssistantRenderItem {
  return {
    kind: 'tool-group',
    partIndexes: [0],
    summary: 'Read source',
    defaultOpen: false,
    ...overrides
  }
}

function message(parts: UIMessage['parts']): UIMessage {
  return { id: 'assistant', role: 'assistant', parts } as UIMessage
}

function props(
  item: AssistantRenderItem,
  msg: UIMessage,
  extra: Partial<ActivityGroupPartProps> = {}
): ActivityGroupPartProps {
  return { item, message: msg, streaming: false, ...extra }
}

describe('activity group memo 内容指纹', () => {
  it('同内容不同引用 → 相等（memo 命中，跳过 reconcile）', () => {
    const msg = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    const prev = props(toolGroupItem(), msg)
    const next = props(toolGroupItem(), msg)
    expect(prev.item).not.toBe(next.item)
    expect(activityGroupPropsEqual(prev, next)).toBe(true)
  })

  it('text 内容增长 → 不等（流式尾部重算）', () => {
    const before = message([{ type: 'text', text: 'hello', state: 'streaming' } as never])
    const after = message([{ type: 'text', text: 'hello world', state: 'streaming' } as never])
    expect(
      activityGroupPropsEqual(props(toolGroupItem(), before), props(toolGroupItem(), after))
    ).toBe(false)
  })

  it('part state streaming→done → 不等（shimmer 活性切换）', () => {
    const before = message([{ type: 'text', text: 'hello', state: 'streaming' } as never])
    const after = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    expect(
      activityGroupPropsEqual(props(toolGroupItem(), before), props(toolGroupItem(), after))
    ).toBe(false)
  })

  it('tool output 增长（string）→ 不等', () => {
    const make = (output: string): UIMessage =>
      message([
        {
          type: 'dynamic-tool',
          toolName: 'fs_read',
          toolCallId: '1',
          state: 'output-available',
          input: { toolCallTitle: 'Read source' },
          output
        } as never
      ])
    expect(
      activityGroupPropsEqual(props(toolGroupItem(), make('a')), props(toolGroupItem(), make('ab')))
    ).toBe(false)
  })

  it('tool output 增长（object，state 相同）→ 不等（防展开卡片 stale）', () => {
    const make = (matches: unknown[]): UIMessage =>
      message([
        {
          type: 'dynamic-tool',
          toolName: 'fs_grep',
          toolCallId: '1',
          state: 'streaming',
          input: { toolCallTitle: 'Grep' },
          output: { matches }
        } as never
      ])
    const one = make([{ path: 'a' }])
    const two = make([{ path: 'a' }, { path: 'b' }])
    expect(activityGroupPropsEqual(props(toolGroupItem(), one), props(toolGroupItem(), two))).toBe(
      false
    )
  })

  it('totalProcessingMs 变化 → 不等（LiveProcessingDuration baseMs）', () => {
    const previous = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    previous.metadata = { totalProcessingMs: 0 } as UIMessage['metadata']
    const next = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    next.metadata = { totalProcessingMs: 5000 } as UIMessage['metadata']
    expect(
      activityGroupPropsEqual(props(toolGroupItem(), previous), props(toolGroupItem(), next))
    ).toBe(false)
  })

  it('item 摘要/图标/defaultOpen/partIndexes 变化 → 不等', () => {
    const msg = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem(), msg),
        props(toolGroupItem({ summary: 'Other tool' }), msg)
      )
    ).toBe(false)
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem(), msg),
        props(toolGroupItem({ icon: 'wrench' }), msg)
      )
    ).toBe(false)
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem(), msg),
        props(toolGroupItem({ defaultOpen: true }), msg)
      )
    ).toBe(false)
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem(), msg),
        props(toolGroupItem({ partIndexes: [1] }), msg)
      )
    ).toBe(false)
  })

  it('streaming 变化 → 不等，onOpenChange 变化 → 相等（闭包行为稳定）', () => {
    const msg = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    const base = props(toolGroupItem(), msg)
    expect(activityGroupPropsEqual(base, { ...base, streaming: true })).toBe(false)
    const handlerA = (): void => undefined
    const handlerB = (): void => undefined
    expect(
      activityGroupPropsEqual(props(toolGroupItem(), msg, { onOpenChange: handlerA }), {
        ...props(toolGroupItem(), msg),
        onOpenChange: handlerB
      })
    ).toBe(true)
  })

  it('children 树变化 → 不等（递归比较）', () => {
    const msg = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    const group = (child: AssistantRenderItem): AssistantRenderItem => ({
      kind: 'activity-group',
      partIndexes: [0],
      summary: '处理过程',
      defaultOpen: true,
      children: [child]
    })
    expect(
      activityGroupPropsEqual(
        props(group(toolGroupItem()), msg),
        props(group(toolGroupItem({ summary: 'Changed' })), msg)
      )
    ).toBe(false)
    expect(
      activityGroupPropsEqual(
        props(group(toolGroupItem()), msg),
        props(group(toolGroupItem()), msg)
      )
    ).toBe(true)
  })

  it('missing part 稳定、索引越界不抛错、索引不同不等', () => {
    const msg = message([{ type: 'text', text: 'hello', state: 'done' } as never])
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem({ partIndexes: [99] }), msg),
        props(toolGroupItem({ partIndexes: [99] }), msg)
      )
    ).toBe(true)
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem({ partIndexes: [0] }), msg),
        props(toolGroupItem({ partIndexes: [99] }), msg)
      )
    ).toBe(false)
  })

  it('非内容型 part（file/step-start）同 type 相同 → 相等', () => {
    const make = (): UIMessage =>
      message([
        { type: 'step-start' } as never,
        { type: 'file', mimeType: 'text/plain', name: 'a.txt', url: 'file:///a.txt' } as never
      ])
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem({ partIndexes: [0, 1] }), make()),
        props(toolGroupItem({ partIndexes: [0, 1] }), make())
      )
    ).toBe(true)
    const other = message([
      { type: 'step-start' } as never,
      { type: 'file', mimeType: 'text/plain', name: 'b.txt', url: 'file:///b.txt' } as never
    ])
    expect(
      activityGroupPropsEqual(
        props(toolGroupItem({ partIndexes: [0, 1] }), make()),
        props(toolGroupItem({ partIndexes: [0, 1] }), other)
      )
    ).toBe(true)
  })

  it('outputSize 覆盖常见输出结构', () => {
    expect(outputSize(null)).toBe(0)
    expect(outputSize(undefined)).toBe(0)
    expect(outputSize('abc')).toBe(3)
    expect(outputSize([1, 2, 3])).toBe(3)
    expect(outputSize({ text: 'hello' })).toBe(5)
    expect(outputSize({ matches: [{}, {}], other: 1 })).toBe(2)
    expect(outputSize({ a: 1, b: 2 })).toBe(2)
    expect(outputSize(42)).toBe(0)
  })

  it('renderItemContentEquals 同引用快速返回 true', () => {
    const item = toolGroupItem()
    expect(renderItemContentEquals(item, item)).toBe(true)
  })
})
