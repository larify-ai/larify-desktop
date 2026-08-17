// @vitest-environment jsdom

import { act, createElement, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileStatusResult } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchTabActionsContext } from '../../../../src/renderer/src/app/workbench/workbench-tab-actions'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  decorations: new Map<string, string>(),
  error: undefined as string | undefined,
  loading: false,
  layoutProps: vi.fn(),
  openPath: '',
  statuses: [] as FileStatusResult[],
  treeProps: vi.fn(),
  useGitDecorations: vi.fn()
}))

vi.mock('../../../../src/extensions/workspace/renderer/changes/use-git-decorations', () => ({
  useGitDecorations: (resourceId: number, root: string, options: unknown) => {
    h.useGitDecorations(resourceId, root, options)
    return {
      decorations: h.decorations,
      error: h.error,
      loading: h.loading,
      statuses: h.statuses
    }
  }
}))

vi.mock('../../../../src/extensions/workspace/renderer/explorer/workspace-tree', () => ({
  WorkspaceTree: (props: { onOpen(path: string): void }) => {
    h.treeProps(props)
    return createElement(
      'button',
      { 'data-testid': 'tree-open', onClick: () => props.onOpen(h.openPath) },
      'open'
    )
  }
}))

vi.mock('../../../../src/extensions/workspace/renderer/layout/workspace-layout', () => ({
  WorkspaceLayout: (props: {
    animating?: boolean
    children: ReactNode
    navigator?: ReactNode
    navigatorOpen: boolean
    visible?: boolean
  }) => {
    h.layoutProps(props)
    return createElement(
      'div',
      null,
      createElement('main', null, props.children),
      props.navigatorOpen && props.navigator
        ? createElement('aside', { 'data-testid': 'navigator' }, props.navigator)
        : null
    )
  }
}))

vi.mock('../../../../src/extensions/workspace/renderer/changes/monaco-diff', () => ({
  MonacoDiff: ({ mode, status }: { mode: string; status: FileStatusResult }) =>
    createElement('div', { 'data-mode': mode, 'data-path': status.path, 'data-testid': 'diff' })
}))

import { ChangesView } from '../../../../src/extensions/workspace/renderer/changes/changes-view'

const status = (path: string, index = ' ', working_dir = 'M'): FileStatusResult =>
  ({ index, path, working_dir }) as FileStatusResult

describe('ChangesView', () => {
  let container: HTMLDivElement
  let reactRoot: Root
  const updateTab = vi.fn()

  function Harness(): React.JSX.Element {
    const [actions, setActions] = useState<ReactNode>(null)
    return createElement(
      WorkbenchTabActionsContext.Provider,
      { value: setActions },
      createElement('div', { 'data-testid': 'actions' }, actions),
      createElement(ChangesView, {
        cwd: 'D:\\workspace',
        resourceId: 7,
        sessionId: 'session',
        updateTab
      })
    )
  }

  const render = async (): Promise<void> => {
    await act(async () => {
      reactRoot.render(createElement(Harness))
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    h.decorations = new Map()
    h.error = undefined
    h.loading = false
    h.layoutProps.mockClear()
    h.openPath = ''
    h.statuses = []
    container = document.createElement('div')
    document.body.append(container)
    reactRoot = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => reactRoot.unmount())
    container.remove()
  })

  it('shows an empty state without a navigator or tab actions', async () => {
    await render()

    expect(container.textContent).toContain('暂无变更')
    expect(container.querySelector('[data-testid="navigator"]')).toBeNull()
    expect(container.querySelector('[data-testid="actions"]')?.childElementCount).toBe(0)
    expect(h.useGitDecorations).toHaveBeenCalledWith(7, 'D:\\workspace', {
      includeIgnored: false
    })
    expect(updateTab).toHaveBeenLastCalledWith({ title: '变更', tooltip: '全部变更' })
  })

  it('remeasures its layout when the native workbench becomes visible', async () => {
    await render()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-animation', {
          detail: { animating: false, visible: true }
        })
      )
    })

    expect(h.layoutProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ animating: false, visible: true })
    )
  })

  it('does not report an empty repository before the initial status loads', async () => {
    h.loading = true
    await render()

    expect(container.textContent).not.toContain('暂无变更')
    expect(container.querySelector('[data-testid="diff"]')).toBeNull()
    expect(container.querySelector('[data-testid="navigator"]')).toBeNull()
  })

  it('shows Git status failures instead of reporting no changes', async () => {
    h.error = '无法读取 Git 状态'
    await render()

    expect(container.textContent).toContain('无法读取 Git 状态')
    expect(container.textContent).not.toContain('暂无变更')
  })

  it('renders changed files, switches modes, and toggles the navigator', async () => {
    const changed = status('D:\\workspace\\changed.ts')
    h.statuses = [changed, status('D:\\workspace\\ignored.ts', '!', '!')]
    await render()

    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      changed.path
    )
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-mode')).toBe(
      'unified'
    )
    expect(container.querySelector('[data-testid="navigator"]')).not.toBeNull()
    expect(h.treeProps.mock.lastCall?.[0].entries[0].children).toHaveLength(1)

    await act(async () =>
      (container.querySelector('[aria-label="切换到拆分视图"]') as HTMLButtonElement).click()
    )
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-mode')).toBe('split')

    await act(async () =>
      (container.querySelector('[aria-label="隐藏变更目录树"]') as HTMLButtonElement).click()
    )
    expect(container.querySelector('[data-testid="navigator"]')).toBeNull()
  })

  it('falls back to the first change when the selected change disappears', async () => {
    const first = status('D:\\workspace\\first.ts')
    const second = status('D:\\workspace\\second.ts')
    h.statuses = [first, second]
    h.openPath = second.path
    await render()
    await act(async () =>
      (container.querySelector('[data-testid="tree-open"]') as HTMLButtonElement).click()
    )
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      second.path
    )

    h.statuses = [first]
    await render()
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      first.path
    )

    expect(updateTab).toHaveBeenLastCalledWith({ title: '变更', tooltip: first.path })
  })
})
