// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../../src/renderer/src/app/navigation/workspace'
import type { WorkspacePreview } from '../../../src/renderer/src/app/navigation/workspaces'

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

function renderWorkspace(values: Partial<WorkspacePreview> = {}): void {
  const workspace: WorkspacePreview = {
    id: 'workspace',
    name: 'Workspace',
    sessions: Array.from({ length: 12 }, (_, index) => ({
      id: String(index + 1),
      name: `Session ${index + 1}`
    })),
    ...values
  }
  act(() => root.render(createElement(Workspace, { workspace })))
}

function click(text: string): void {
  const button = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === text
  )
  act(() => button?.click())
}

function visibleSessions(): string[] {
  return [...container.querySelectorAll('button')]
    .map((element) => element.textContent ?? '')
    .filter((text) => text.startsWith('Session'))
}

describe('navigation workspace', () => {
  it('reveals five more sessions on each click', () => {
    renderWorkspace()
    expect(visibleSessions()).toHaveLength(5)

    click('更多')
    expect(visibleSessions()).toHaveLength(10)

    click('更多')
    expect(visibleSessions()).toHaveLength(12)
    expect(container.textContent).not.toContain('更多')
  })

  it('resets to five sessions after collapsing', () => {
    renderWorkspace()
    click('更多')
    click('Workspace')
    expect(visibleSessions()).toHaveLength(0)

    click('Workspace')
    expect(visibleSessions()).toHaveLength(5)
  })

  it('does not show more when all sessions fit on the first page', () => {
    renderWorkspace({
      sessions: Array.from({ length: 5 }, (_, index) => ({
        id: String(index),
        name: `Session ${index}`
      }))
    })

    expect(visibleSessions()).toHaveLength(5)
    expect(container.textContent).not.toContain('更多')
  })

  it('marks and selects the active session', () => {
    const onClick = vi.fn()
    renderWorkspace({
      sessions: [{ id: 'active', name: 'Session active', active: true, onClick }]
    })

    const session = container.querySelector('[aria-current="page"]')
    expect(session?.textContent).toBe('Session active')
    expect(session?.getAttribute('data-session-id')).toBe('active')
    click('Session active')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('loads another page without accepting repeated clicks', async () => {
    let resolve!: () => void
    const onMore = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    const firstPage = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      name: `Session ${index}`
    }))
    renderWorkspace({ sessions: firstPage, hasMore: true, onMore })

    const more = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '更多'
    )
    act(() => {
      more?.click()
      more?.click()
    })
    expect(onMore).toHaveBeenCalledOnce()
    expect(more?.hasAttribute('disabled')).toBe(true)

    await act(async () => resolve())
    expect(more?.hasAttribute('disabled')).toBe(false)

    renderWorkspace({ hasMore: false, onMore })
    expect(visibleSessions()).toHaveLength(10)
  })

  it('allows retrying after loading another page fails', async () => {
    const onMore = vi.fn().mockRejectedValue(new Error('Unavailable'))
    renderWorkspace({ sessions: [], hasMore: true, onMore })

    click('更多')
    await act(async () => {})

    const more = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '更多'
    )
    expect(onMore).toHaveBeenCalledOnce()
    expect(more?.hasAttribute('disabled')).toBe(false)
  })
})
