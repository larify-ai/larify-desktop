// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  ActivityHistoryPart,
  type ActivityHistorySection
} from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/activity-history-part'
import type { AssistantRenderItem } from '../../../../../src/renderer/src/app/interaction/assistant/message-render-items'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
})

function makeGroup(partIndexes: number[], summary: string, title: string): AssistantRenderItem {
  return {
    kind: 'activity-group',
    partIndexes,
    summary: title,
    defaultOpen: false,
    children: [{ kind: 'tool-group', partIndexes, summary, defaultOpen: false }]
  }
}

const message: UIMessage = {
  id: 'assistant',
  role: 'assistant',
  parts: [
    {
      type: 'dynamic-tool',
      toolName: 'fs_read',
      toolCallId: '1',
      state: 'output-available',
      input: { toolCallTitle: '读取现有实现' },
      output: 'done'
    }
  ]
}

function buildSections(stages: Array<{ title: string; streaming: boolean }>): ActivityHistorySection[] {
  return stages.map((stage) => ({
    title: stage.title,
    message,
    item: makeGroup([0], '工具', stage.title),
    streaming: stage.streaming
  }))
}

function stageButtons(): HTMLButtonElement[] {
  const titles = new Set(['调研', '实现', '验证'])
  return [
    ...container.querySelectorAll<HTMLButtonElement>('[data-activity-group] > button')
  ].filter((button) => titles.has(button.textContent?.trim()))
}

let persist: Map<string, boolean>

async function renderHistory(sections: ActivityHistorySection[]): Promise<void> {
  await act(async () =>
    root.render(
      createElement(ActivityHistoryPart, {
        sections,
        waiting: false,
        initialOpen: true,
        stageOpen: {
          get: (key) => persist.get(key),
          set: (key, open) => persist.set(key, open)
        }
      })
    )
  )
}

async function remount(sections: ActivityHistorySection[]): Promise<void> {
  await act(async () => root.unmount())
  root = createRoot(container)
  await renderHistory(sections)
}

describe('activity history 阶段分组展开状态持久化（虚拟列表回收重挂载）', () => {
  beforeEach(() => {
    persist = new Map<string, boolean>()
  })

  it('bug 主场景：手动展开的已完成 stage 在 remount 后保持展开', async () => {
    const sections = buildSections([
      { title: '调研', streaming: false },
      { title: '实现', streaming: true }
    ])

    await renderHistory(sections)
    const buttons = stageButtons()
    expect(buttons.length).toBe(2)
    // 已完成 stage 默认折叠，流式 stage 默认展开
    expect(buttons[0].getAttribute('data-state')).toBe('closed')
    expect(buttons[1].getAttribute('data-state')).toBe('open')

    // 用户点击第一个（已完成）stage 展开
    await act(async () => buttons[0].click())
    expect(stageButtons()[0].getAttribute('data-state')).toBe('open')
    // 持久化通道把该 stage 的展开状态写入 store
    expect(persist.get(`${message.id}-section-0`)).toBe(true)

    // 虚拟列表回收后重挂载
    await remount(sections)
    // 关键：重挂载后仍保持展开，而不是弹回折叠
    expect(stageButtons()[0].getAttribute('data-state')).toBe('open')
  })

  it('反向场景：手动收起的流式 stage 在 remount 后保持收起', async () => {
    const sections = buildSections([{ title: '实现', streaming: true }])

    await renderHistory(sections)
    // 流式 stage 默认展开
    expect(stageButtons()[0].getAttribute('data-state')).toBe('open')

    // 用户点击收起
    await act(async () => stageButtons()[0].click())
    expect(stageButtons()[0].getAttribute('data-state')).toBe('closed')
    expect(persist.get(`${message.id}-section-0`)).toBe(false)

    await remount(sections)
    // 关键：重挂载后仍保持收起
    expect(stageButtons()[0].getAttribute('data-state')).toBe('closed')
  })

  it('非回归：从未交互的已完成 stage 在 remount 后仍折叠（defaultOpen 行为不变）', async () => {
    const sections = buildSections([
      { title: '调研', streaming: false },
      { title: '实现', streaming: false }
    ])

    await renderHistory(sections)
    expect(stageButtons()[0].getAttribute('data-state')).toBe('closed')

    await remount(sections)
    // 用户没有交互，保持默认折叠
    expect(stageButtons()[0].getAttribute('data-state')).toBe('closed')
  })

  it('非回归：从未交互的流式 stage 在 remount 后仍展开（defaultOpen 行为不变）', async () => {
    const sections = buildSections([{ title: '实现', streaming: true }])

    await renderHistory(sections)
    expect(stageButtons()[0].getAttribute('data-state')).toBe('open')

    await remount(sections)
    expect(stageButtons()[0].getAttribute('data-state')).toBe('open')
  })

  it('组件保持挂载、仅流式更新消息时，内层 stage 展开状态保持不丢', async () => {
    // 区分性验证：若真实触发只是"整体行 remount"，则仅更新 message（原地 mutation，
    // 引用变化）而不卸载组件时，用户展开的内层 stage 不应被收起。这证明内层
    // 不会因流式更新 re-mount（section 的 key `message.id-index` 稳定），
    // 从而确认"整体行 remount"是唯一触发因素，外层持久化是必要的。
    const sections = buildSections([
      { title: '调研', streaming: false },
      { title: '实现', streaming: true }
    ])

    await renderHistory(sections)
    expect(stageButtons()[0].getAttribute('data-state')).toBe('closed')

    // 用户点击第一个已完成 stage 展开
    await act(async () => stageButtons()[0].click())
    expect(stageButtons()[0].getAttribute('data-state')).toBe('open')

    // 模拟流式推进：sections 数组重建（对象引用变化），但 message.id / index 稳定，
    // 组件本身保持挂载（不 unmount）。React 对同 key 的 ActivityGroupPart 保留实例。
    await act(async () =>
      root.render(
        createElement(ActivityHistoryPart, {
          sections: [
            { ...sections[0], item: { ...sections[0].item } },
            { ...sections[1], streaming: true }
          ],
          waiting: false,
          initialOpen: true,
          stageOpen: {
            get: (key) => persist.get(key),
            set: (key, open) => persist.set(key, open)
          }
        })
      )
    )

    // 内层 stage 未 re-mount，用户展开状态保持
    expect(stageButtons()[0].getAttribute('data-state')).toBe('open')
  })

  it('stageOpen 持久化通道：展开/收起都会调用 set 并记录到 store', async () => {
    const sections = buildSections([{ title: '实现', streaming: true }])
    const setSpy = vi.fn()
    await act(async () =>
      root.render(
        createElement(ActivityHistoryPart, {
          sections,
          waiting: false,
          initialOpen: true,
          stageOpen: {
            get: (key) => persist.get(key),
            set: (key, open) => {
              persist.set(key, open)
              setSpy(key, open)
            }
          }
        })
      )
    )

    await act(async () => stageButtons()[0].click())
    expect(setSpy).toHaveBeenCalledWith(`${message.id}-section-0`, false)
    expect(persist.get(`${message.id}-section-0`)).toBe(false)
  })
})
