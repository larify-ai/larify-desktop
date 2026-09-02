// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantSessionsContext } from '../../../src/renderer/src/app/interaction/assistant/sessions-context'
import { AuthContext } from '../../../src/renderer/src/app/auth/auth-context'
import { NavigationContent } from '../../../src/renderer/src/app/navigation/navigation-content'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

function renderNavigation(create = vi.fn()): void {
  const activeSession = {
    id: 'active',
    heading: { cwd: 'D:\\Workspace', title: 'Current session' }
  }
  const sessions = {
    sessions: [activeSession],
    directory: [
      {
        cwd: 'D:\\Workspace',
        sessions: [{ id: 'stored', title: 'Stored session', cwd: 'D:\\Workspace' }],
        hasMore: false
      }
    ],
    activeId: activeSession.id,
    activeSession,
    create,
    select: vi.fn(),
    loadMore: vi.fn(),
    refresh: vi.fn(),
    setHeading: vi.fn(),
    attentionState: vi.fn(() => 'idle' as const)
  }

  act(() =>
    root.render(
      createElement(
        AssistantSessionsContext.Provider,
        { value: sessions },
        createElement(
          AuthContext.Provider,
          { value: { email: 'test@larify.ai', logout: vi.fn() } },
          createElement(NavigationContent)
        )
      )
    )
  )
}

describe('navigation content', () => {
  it('connects the global actions and workspace directory', () => {
    const create = vi.fn()
    renderNavigation(create)

    expect(container.querySelector('nav[aria-label="全局入口"]')).not.toBeNull()
    const workspaceList = container.querySelector('nav[aria-labelledby="workspaces-heading"]')
    const workspaceHeading = container.querySelector('#workspaces-heading')
    expect(workspaceList).not.toBeNull()
    expect(workspaceHeading?.tagName).toBe('H2')
    expect(workspaceList?.className).toContain('overflow-y-auto')
    expect(workspaceList?.contains(workspaceHeading)).toBe(false)
    // 暂时注释：百宝箱/知识库入口已隐藏，恢复入口时恢复以下断言
    // expect(container.textContent).toContain('百宝箱')
    // expect(container.textContent).toContain('知识库')
    expect(container.textContent).toContain('Workspace')
    expect(container.textContent).toContain('Stored session')
    expect(container.textContent).not.toContain('Current session')

    const newTask = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '新建任务'
    )
    act(() => newTask?.click())
    expect(create).toHaveBeenCalledWith()
  })

  it('creates a task in a directory selected from the add workspace action', async () => {
    const create = vi.fn()
    const invoke = vi.fn().mockResolvedValue(['D:\\Added workspace'])
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: { invoke }
    })
    renderNavigation(create)

    const add = container.querySelector<HTMLButtonElement>('[aria-label="添加工作空间"]')
    await act(async () => add?.click())

    expect(invoke).toHaveBeenCalledWith('dialog:pick-directories')
    expect(create).toHaveBeenCalledWith('D:\\Added workspace')
  })
})
