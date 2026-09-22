// @vitest-environment jsdom
/**
 * 探针（只读诊断）：判定「UI 上每一项都出现两个」的来源。
 * 用**真实 AssistantMessageList** 渲染，统计每个 stage 标题在 DOM 中的**精确**出现次数。
 *
 * 场景：
 *  A) 截图时刻的 DB 行（0..5）—— 刷新后应当是正确的。
 *  B) 再注入「主链行 [1] 的超集副本（同内容、不同 id）」—— 模拟渲染层 live-state 污染。
 *
 * ⚠️ 精确计数：只统计 **stage 折叠头按钮的文本**（`[data-activity-group] > button` 的
 * 第一个文本节点 / 或按钮自身 textContent 去空白后等于标题），避免把内容里的同名字符串算进来。
 */
import { act, createElement, forwardRef, useEffect, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'

const captured = vi.hoisted(() => ({ props: undefined as unknown, mounts: 0 }))

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function Virtuoso(props: unknown, ref) {
    captured.props = props
    useEffect(() => {
      captured.mounts += 1
    }, [])
    useImperativeHandle(ref, () => ({
      autoscrollToBottom: vi.fn(),
      scrollToIndex: vi.fn(),
      getState: (cb: (s: unknown) => void) =>
        cb({ ranges: [{ startIndex: 0, endIndex: 0, size: 320 }], scrollTop: 0 })
    }))
    return null
  })
}))

import { AssistantMessageList } from '../../../src/renderer/src/app/interaction/assistant/message-list'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const LOG: string[] = []
const log = (s: string): void => void LOG.push(s)

const DB = 'C:/Users/hylnb/AppData/Roaming/larify/sessions.db'
const SID_PREFIX = 'ecdd751e'

function loadSessionRows(): UIMessage[] {
  const db = new DatabaseSync(DB, { readOnly: true })
  const sid = (db.prepare('select id from sessions where id like ?').get(SID_PREFIX + '%') as { id: string }).id
  const rows = db
    .prepare('select value from messages where session_id=? order by position')
    .all(sid) as unknown as Array<{ value: string }>
  db.close()
  return rows.map((r) => JSON.parse(r.value) as UIMessage)
}

function stageTitles(m: UIMessage): string[] {
  return m.parts
    .filter((p) => (p as { type?: string }).type === 'tool-agent_show_progress')
    .map((p) => String((p as { input?: { title?: string } }).input?.title ?? ''))
    .filter(Boolean)
}

let container: HTMLDivElement
let root: Root
class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(_cb: ResizeObserverCallback) {}
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  captured.mounts = 0
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

async function render(
  messages: UIMessage[],
  recentStart = 0,
  olderMessages = new Map<number, UIMessage>(),
  live = false
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AssistantMessageList, {
        active: true,
        messages,
        live,
        followRequest: 0,
        recentStart,
        olderMessages,
        navigationItems: [],
        onLoadRange: vi.fn()
      })
    )
  )
}

/** 渲染每个 item，收集所有 stage 折叠头按钮的文本（精确计数）。 */
async function collectStageHeaders(expand = true): Promise<string[]> {
  const props = captured.props as { totalCount: number; itemContent(i: number): React.JSX.Element }
  const host = document.createElement('div')
  document.body.append(host)
  const r = createRoot(host)
  const headers: string[] = []
  try {
    for (let i = 0; i < props.totalCount; i += 1) {
      await act(async () => r.render(props.itemContent(i)))
      if (expand) {
        for (let pass = 0; pass < 4; pass += 1) {
          const closed = [...host.querySelectorAll<HTMLButtonElement>('button[data-state="closed"]')]
          if (!closed.length) break
          for (const b of closed) await act(async () => b.click())
        }
      }
      // 精确：只取 stage 折叠头（[data-activity-group] > button）
      for (const b of host.querySelectorAll<HTMLButtonElement>('[data-activity-group] > button')) {
        const t = (b.textContent ?? '').trim()
        if (t) headers.push(t)
      }
    }
  } finally {
    await act(async () => r.unmount())
    host.remove()
  }
  return headers
}

function tally(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const h of headers) out[h] = (out[h] ?? 0) + 1
  return out
}

describe('探针：UI 重复 item 的来源（精确计数 stage 折叠头）', () => {
  it('A. 截图时刻的 DB 行（0..5）：stage 折叠头次数', async () => {
    const rows = loadSessionRows()
    const shot = rows.slice(0, 6) // pos 6780..6785
    log(`\n=== A. 渲染 rows[0..5]（截图时刻）===`)
    shot.forEach((m, i) =>
      log(`  [${i}] ${m.role} id=${m.id.slice(0, 34)} nested=${(m.metadata as Record<string, unknown> | undefined)?.nested} parts=${m.parts.length} stages=${stageTitles(m).length}`)
    )
    await render(shot, 0)
    log(`  totalCount=${(captured.props as { totalCount: number }).totalCount}`)
    const mainTitles = stageTitles(rows[1])
    const counts = tally(await collectStageHeaders())
    const dup = mainTitles.filter((t) => (counts[t] ?? 0) > 1)
    log(`  主链轮[1] 的 16 个标题：出现次数分布 = ${JSON.stringify(mainTitles.map((t) => counts[t] ?? 0))}`)
    log(`  >>> 主链轮标题出现 >1 次的数量 = ${dup.length}`)
    const allDup = Object.entries(counts).filter(([, c]) => c > 1)
    log(`  >>> 全卡内 >1 次的标题 = ${JSON.stringify(allDup)}`)
    writeFileSync('tmp-probe/ui-dup-A.json', JSON.stringify({ counts, total: (captured.props as { totalCount: number }).totalCount }, null, 2))
    expect(true).toBe(true)
  }, 40000)

  it('B. 注入主链行的 live 超集副本：stage 折叠头次数', async () => {
    const rows = loadSessionRows()
    const main = rows[1]
    const copy: UIMessage = { ...main, id: `${main.id}-COPY` }
    const live = [...rows.slice(0, 2), copy, ...rows.slice(2, 6)]
    log(`\n=== B. rows[0..5] + 主链行超集副本（id 不同、内容相同）===`)
    await render(live, 0)
    log(`  totalCount=${(captured.props as { totalCount: number }).totalCount}`)
    const mainTitles = stageTitles(main)
    const counts = tally(await collectStageHeaders())
    log(`  主链轮标题出现次数分布 = ${JSON.stringify(mainTitles.map((t) => counts[t] ?? 0))}`)
    log(`  >>> 出现 >1 次的数量 = ${mainTitles.filter((t) => (counts[t] ?? 0) > 1).length}`)
    writeFileSync('tmp-probe/ui-dup-B.json', JSON.stringify({ counts, total: (captured.props as { totalCount: number }).totalCount }, null, 2))
    expect(true).toBe(true)
  }, 40000)
})

afterEach(() => {
  for (const line of LOG.splice(0)) console.error(line)
})
