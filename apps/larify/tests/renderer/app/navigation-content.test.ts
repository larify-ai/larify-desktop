// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantSessionsContext } from '../../../src/renderer/src/app/interaction/assistant/sessions-context'
import { NavigationContent } from '../../../src/renderer/src/app/navigation/navigation-content'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
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
    setHeading: vi.fn()
  }

  act(() =>
    root.render(
      createElement(
        AssistantSessionsContext.Provider,
        { value: sessions },
        createElement(NavigationContent)
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
    expect(workspaceList?.className).toContain('overflow-y-auto')
    expect(workspaceList?.contains(workspaceHeading)).toBe(false)
    expect(container.textContent).toContain('百宝箱')
    expect(container.textContent).toContain('知识库')
    expect(container.textContent).toContain('Workspace')
    expect(container.textContent).toContain('Stored session')
    expect(container.textContent).not.toContain('Current session')

    const newTask = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '新建任务'
    )
    act(() => newTask?.click())
    expect(create).toHaveBeenCalledOnce()
  })
})
