// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { ActivityHistoryPart } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/activity-history-part'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toolItem = (summary: string) => ({
  kind: 'tool-group' as const,
  partIndexes: [0],
  summary,
  defaultOpen: false
})

const assistant = (id: string, metadata: Record<string, unknown>): UIMessage =>
  ({
    id,
    role: 'assistant',
    metadata,
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'read',
        toolCallId: '1',
        state: 'output-available',
        input: { toolCallTitle: 'Read source' },
        output: 'done'
      }
    ]
  }) as UIMessage

const section = (message: UIMessage, title: string, streaming = false) => ({
  title,
  message,
  item: toolItem(title),
  streaming
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('activity history part summary duration', () => {
  // 复现（必须失败 → 修复后通过）：卡片展开时，旧实现以「是否展开」(`defaultOpen`) 选时长取值，
  // 展开态一律走 `LiveProcessingDuration` = baseMs + (now - startedAt)，即**墙钟实时计时**。
  // 对一个「已结束（已完成）但用户手动展开」的卡，墙钟会从 startedAt 起一路累加：若 startedAt
  // 距“现在”已有 2 小时（模拟「今天的会话，用户几小时后再展开查看」），摘要会显示“2小时30分0秒”，
  // 而正确的累计时长只有 8分31秒（且稳定不增长）。
  it('shows the accumulated totalProcessingMs (not a live wall clock) when a completed history is expanded', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000) // “现在”距 startedAt 已是 2.5 小时
    const startedAt = 1_000_000
    const metadata = {
      startedAt,
      completedAt: startedAt + 500_000,
      totalProcessingMs: 510_593,
      outcome: 'completed'
    }
    try {
      // 断言前先确认新实现的关键行为：已完成 → 走 durationPart。
      // 旧实现此处会渲染“处理了 2小时 30分钟 0秒”，故断言“不含小时”会失败 → 证明 bug 存在。
      await act(async () =>
        root.render(
          createElement(ActivityHistoryPart, {
            sections: [section(assistant('a', metadata), '调研')],
            initialOpen: true,
            active: true
          })
        )
      )

      // totalProcessingMs = 510593ms → ceil(510593/1000)=511s → 8分31秒。
      expect(container.textContent).toContain('已完成 · 处理了 8分钟 31秒')
      expect(container.textContent).not.toContain('小时')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the accumulated duration for an aborted history when expanded', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)
    const metadata = {
      startedAt: 1_000_000,
      completedAt: 1_500_000,
      totalProcessingMs: 909_274,
      outcome: 'aborted'
    }
    try {
      await act(async () =>
        root.render(
          createElement(ActivityHistoryPart, {
            sections: [section(assistant('a', metadata), '调研')],
            initialOpen: true,
            active: true
          })
        )
      )

      // formatProcessingDurationMs 用 Math.ceil(totalMs/1000)：909274 → 910s → 15分10秒。
      expect(container.textContent).toContain('已中断 · 处理了 15分钟 10秒')
      // 已结束的卡不得随墙钟显示“小时”级时长。
      expect(container.textContent).not.toContain('小时')
    } finally {
      vi.useRealTimers()
    }
  })

  it('still shows a live duration while the history is actually streaming', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(6_000)
    try {
      await act(async () =>
        root.render(
          createElement(ActivityHistoryPart, {
            sections: [section(assistant('a', { startedAt: 1_000 }), '调研', true)],
            initialOpen: true,
            active: true
          })
        )
      )

      // 真 streaming（sections.some(streaming)）→ 仍用 LiveProcessingDuration（now-startedAt）。
      expect(container.textContent).toContain('处理了 5秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the accumulated duration (not the wall clock) for a waiting card with a recorded duration', async () => {
    // 复现（必须失败 → 修复后通过）：等待回答的卡展示了「已完成」的进度阶段（已记录 totalProcessingMs）。
    // 旧实现因 `defaultOpen`（waiting 使其展开）为真，waiting 分支不看是否有累计时长，走墙钟 → 显示“小时”级。
    // 修复后统一按 durationPart 取值：等待回答 · 8分31秒。
    vi.useFakeTimers()
    vi.setSystemTime(10_000_000)
    const metadata = {
      startedAt: 1_000_000,
      completedAt: 1_500_000,
      totalProcessingMs: 510_593
    }
    try {
      await act(async () =>
        root.render(
          createElement(ActivityHistoryPart, {
            sections: [section(assistant('a', metadata), '调研')],
            waiting: true,
            initialOpen: true,
            active: true
          })
        )
      )

      expect(container.textContent).toContain('等待回答 · 处理了 8分钟 31秒')
      expect(container.textContent).not.toContain('小时')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a bare waiting label when no duration has been recorded yet', async () => {
    // waiting 且尚无 totalProcessingMs/completedAt（首轮尚未结束）：无 durationPart，只显示「等待回答」。
    vi.useFakeTimers()
    vi.setSystemTime(6_000)
    try {
      await act(async () =>
        root.render(
          createElement(ActivityHistoryPart, {
            sections: [section(assistant('a', { startedAt: 1_000 }), '调研')],
            waiting: true,
            initialOpen: true,
            active: true
          })
        )
      )

      expect(container.textContent).toContain('等待回答')
      expect(container.textContent).not.toContain('处理了')
    } finally {
      vi.useRealTimers()
    }
  })
})
