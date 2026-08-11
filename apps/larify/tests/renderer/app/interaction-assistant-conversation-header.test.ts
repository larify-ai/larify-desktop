// @vitest-environment jsdom

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { ConversationHeader } from '../../../src/renderer/src/app/interaction/assistant/conversation-header'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ConversationHeader', () => {
  it('shows the workspace before the conversation title', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ConversationHeader, {
          cwd: 'D:\\Workspace\\larify-desktop',
          title: '检查插件架构'
        })
      )
    })

    expect(container.textContent).toBe('larify-desktop检查插件架构')
    await act(async () => root.unmount())
  })

  it('keeps the full title and lets the available width truncate it', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const title = '这是一个非常长的会话标题示例'

    await act(async () => {
      root.render(
        createElement(ConversationHeader, {
          cwd: 'D:\\Workspace\\larify-desktop',
          title
        })
      )
    })

    const heading = container.querySelector(`[title="${title}"]`)
    expect(heading?.textContent).toBe(title)
    expect(heading?.classList).toContain('flex-1')
    expect(heading?.classList).toContain('truncate')
    expect(heading?.parentElement?.classList).toContain('w-full')
    expect(heading?.parentElement?.classList).toContain('overflow-hidden')
    await act(async () => root.unmount())
  })
})
