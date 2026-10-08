// @vitest-environment jsdom

import { DatabaseSync } from 'node:sqlite'
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
      getState: (cb: (s: unknown) => void) => cb({ ranges: [], scrollTop: 0 })
    }))
    return null
  })
}))

import { AssistantMessageList } from '../../../../../src/renderer/src/app/interaction/assistant/message-list'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface VirtuosoProps {
  totalCount: number
  computeItemKey(index: number): React.Key
  itemContent(index: number): React.JSX.Element
}

const SID = '648dcb99'

function loadMessages(): UIMessage[] {
  const p = (process.env.APPDATA || '') + '/larify/sessions.db'
  const db = new DatabaseSync(p, { readOnly: true })
  const sess = db.prepare('SELECT id, start FROM sessions WHERE id LIKE ?').get(SID + '%') as {
    id: string
    start: number | null
  }
  const rows = db
    .prepare(
      'SELECT position, value FROM messages WHERE session_id=? AND (COALESCE(?, -1) = -1 OR position <> ?) ORDER BY position'
    )
    .all(sess.id, sess.start, sess.start)
  return rows.map((r) => JSON.parse((r as { value: string }).value) as UIMessage)
}

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(_cb: ResizeObserverCallback) {}
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('真实渲染：robot_lab模型 会话的 item 形态', () => {
  it('每个用户提问后的 item 是什么 kind', async () => {
    const messages = loadMessages()
    await act(async () =>
      root.render(
        createElement(AssistantMessageList, {
          active: true,
          messages,
          live: false,
          followRequest: 0,
          recentStart: 0,
          olderMessages: new Map(),
          navigationItems: [],
          onLoadRange: vi.fn() as never
        } as never)
      )
    )
    const props = captured.props as VirtuosoProps
    console.log('totalCount =', props.totalCount)
    const keys: string[] = []
    for (let i = 0; i < props.totalCount; i++) {
      const key = props.computeItemKey(i)
      // 抽出 kind 指纹：key 结尾若为 -activity-history 则是聚合卡
      keys.push(`${i}:${String(key)}`)
    }
    console.log('keys =', keys.join(' | '))
    // 统计 activity-history 卡数量
    const aggCount = keys.filter((k) => k.endsWith('-activity-history')).length
    console.log('aggregated cards =', aggCount)
    // 打印每张聚合卡的 sections（title 列表）——尤其是最后一张（reset 后的轮次）
    for (const key of keys) {
      if (!key.endsWith('-activity-history')) continue
      const i = Number(key.split(':')[0])
      const el = props.itemContent(i)
      let sections: Array<{ title: string; message: { id: string } }> = []
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        const props = (node as { props?: Record<string, unknown> }).props
        if (props && Array.isArray(props.sections)) {
          sections = props.sections as typeof sections
          return
        }
        if (props) {
          visit(props.children)
          const ch = props.children
          if (Array.isArray(ch)) ch.forEach(visit)
        }
      }
      visit(el)
      console.log(
        `CARD ${key} ->`,
        sections
          .map(
            (s) =>
              `[msg=${s.message.id.slice(0, 8)} parts=${s.message.parts.length}] "${s.title}" (itemParts=${(s.item.partIndexes ?? []).length})`
          )
          .join(' , ')
      )
    }
    expect(props.totalCount).toBeGreaterThan(0)
  })
})
