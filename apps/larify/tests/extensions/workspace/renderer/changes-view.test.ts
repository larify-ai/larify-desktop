// @vitest-environment jsdom

import { act, createElement, StrictMode, useState, type ReactNode } from 'react'
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
  inspectFile: vi.fn(),
  readDirectory: vi.fn(),
  statuses: [] as FileStatusResult[],
  treeProps: vi.fn(),
  useGitDecorations: vi.fn(),
  workspaceRoot: 'D:\\workspace'
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

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: {
    inspectFile: (resourceId: number, path: string) => h.inspectFile(resourceId, path),
    readDirectory: (resourceId: number) => h.readDirectory(resourceId)
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
  MonacoDiff: ({
    active,
    animating,
    mode,
    status
  }: {
    active: boolean
    animating: boolean
    mode: string
    status: FileStatusResult
  }) =>
    createElement('div', {
      'data-active': active,
      'data-animating': animating,
      'data-mode': mode,
      'data-path': status.path,
      'data-testid': 'diff'
    })
}))

import { ChangesView } from '../../../../src/extensions/workspace/renderer/changes/changes-view'
import { requestChangesNavigation } from '../../../../src/extensions/workspace/renderer/changes/changes-navigation'

const status = (path: string, index = ' ', working_dir = 'M'): FileStatusResult =>
  ({ index, path, working_dir }) as FileStatusResult

describe('ChangesView', () => {
  let container: HTMLDivElement
  let reactRoot: Root
  const updateTab = vi.fn()

  function Harness({
    active = false,
    resourceId = 7
  }: {
    active?: boolean
    resourceId?: number
  }): React.JSX.Element {
    const [actions, setActions] = useState<ReactNode>(null)
    return createElement(
      WorkbenchTabActionsContext.Provider,
      { value: setActions },
      createElement('div', { 'data-testid': 'actions' }, actions),
      createElement(ChangesView, {
        active,
        cwd: 'D:\\workspace',
        resourceId,
        sessionId: 'session',
        updateTab
      })
    )
  }

  const render = async (resourceId = 7, strict = false, active = false): Promise<void> => {
    await act(async () => {
      const view = createElement(Harness, { active, resourceId })
      reactRoot.render(strict ? createElement(StrictMode, null, view) : view)
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
    h.inspectFile.mockReset()
    h.inspectFile.mockRejectedValue(new Error('ENOENT'))
    h.readDirectory.mockReset()
    h.readDirectory.mockImplementation(() =>
      Promise.resolve({ entries: [], root: h.workspaceRoot })
    )
    h.statuses = []
    h.workspaceRoot = 'D:\\workspace'
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
      active: false,
      includeIgnored: false,
      preloadInactive: true
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

  it('keeps the file preview active while the visible workbench is animating', async () => {
    h.statuses = [status('D:\\workspace\\changed.ts')]
    await render(7, false, true)
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-active')).toBe(
      'false'
    )

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-animation', {
          detail: { animating: true, visible: false }
        })
      )
    })

    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-active')).toBe(
      'true'
    )
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-animating')).toBe(
      'true'
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
    expect(updateTab).toHaveBeenLastCalledWith({
      title: 'changed.ts',
      tooltip: changed.path
    })

    await act(async () =>
      (container.querySelector('[aria-label="切换到拆分视图"]') as HTMLButtonElement).click()
    )
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-mode')).toBe('split')

    await act(async () =>
      (container.querySelector('[aria-label="隐藏变更目录树"]') as HTMLButtonElement).click()
    )
    expect(container.querySelector('[data-testid="navigator"]')).toBeNull()
  })

  it('selects another change when the selected change disappears', async () => {
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
    expect(container.textContent).not.toContain('文件不存在')
    expect(h.inspectFile).not.toHaveBeenCalled()

    expect(updateTab).toHaveBeenLastCalledWith({ title: 'first.ts', tooltip: first.path })
  })

  it('shows no changes when the selected live change is restored to its original content', async () => {
    const changed = status('D:\\workspace\\restored.ts')
    h.statuses = [changed]
    h.openPath = changed.path
    await render()
    await act(async () =>
      (container.querySelector('[data-testid="tree-open"]') as HTMLButtonElement).click()
    )

    h.statuses = []
    await render()

    expect(container.querySelector('[data-testid="diff"]')).toBeNull()
    expect(container.querySelector('[data-testid="navigator"]')).toBeNull()
    expect(container.textContent).toContain('暂无变更')
    expect(container.textContent).not.toContain('文件不存在')
    expect(h.inspectFile).not.toHaveBeenCalled()
    expect(updateTab).toHaveBeenLastCalledWith({ title: '变更', tooltip: '全部变更' })
  })

  it('reports a missing file requested by a historical card', async () => {
    requestChangesNavigation({ path: 'deleted.ts', resourceId: 7 })
    await render()

    expect(h.inspectFile).toHaveBeenCalledWith(7, 'D:\\workspace\\deleted.ts')
    expect(container.textContent).toContain('文件不存在')
  })

  it('clears a historical selection when the file still exists without changes', async () => {
    h.inspectFile.mockResolvedValue({ mime: 'text/plain' })
    requestChangesNavigation({ path: 'clean.ts', resourceId: 7 })
    await render()

    expect(container.textContent).toContain('暂无变更')
    expect(container.textContent).not.toContain('文件不存在')
  })

  it('falls back to a live change when a historical card targets an unchanged file', async () => {
    const changed = status('D:\\workspace\\current.ts')
    h.statuses = [changed]
    h.inspectFile.mockResolvedValue({ mime: 'text/plain' })
    requestChangesNavigation({ path: 'clean.ts', resourceId: 7 })

    await render()

    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      changed.path
    )
    expect(container.textContent).not.toContain('文件不存在')
    expect(updateTab).toHaveBeenLastCalledWith({ title: 'current.ts', tooltip: changed.path })
  })

  it('selects a changed file requested by a card', async () => {
    const first = status('D:\\workspace\\first.ts')
    const second = status('D:\\workspace\\second.ts')
    h.statuses = [first, second]
    await render()

    await act(async () => requestChangesNavigation({ path: 'second.ts', resourceId: 7 }))

    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      second.path
    )
    expect(updateTab).toHaveBeenLastCalledWith({ title: 'second.ts', tooltip: second.path })
  })

  it('selects a Windows change when the requested path uses different casing', async () => {
    const changed = status('D:\\workspace\\File.ts')
    h.statuses = [changed]
    requestChangesNavigation({ path: 'd:\\WORKSPACE\\file.ts', resourceId: 7 })

    await render()

    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      changed.path
    )
  })

  it('does not report a selected file as missing while changes are loading', async () => {
    h.loading = true
    requestChangesNavigation({ path: 'pending.ts', resourceId: 7 })

    await render()

    expect(container.textContent).not.toContain('文件不存在')
  })

  it('shows a status error before reporting a selected file as missing', async () => {
    h.error = 'status failed'
    requestChangesNavigation({ path: 'pending.ts', resourceId: 7 })

    await render()

    expect(container.textContent).toContain('status failed')
    expect(container.textContent).not.toContain('文件不存在')
  })

  it('resolves a card path from the workspace root instead of cwd', async () => {
    const changed = status('D:\\actual-workspace\\src\\changed.ts')
    h.workspaceRoot = 'D:\\actual-workspace'
    h.statuses = [changed]
    requestChangesNavigation({ path: 'src/changed.ts', resourceId: 7 })

    await render()

    expect(h.useGitDecorations).toHaveBeenLastCalledWith(7, h.workspaceRoot, {
      active: false,
      includeIgnored: false,
      preloadInactive: true
    })
    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      changed.path
    )
  })

  it('applies a pending file selection after mounting', async () => {
    const first = status('D:\\workspace\\first.ts')
    const second = status('D:\\workspace\\second.ts')
    h.statuses = [first, second]
    requestChangesNavigation({ path: 'second.ts', resourceId: 7 })

    await render(7, true)

    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      second.path
    )
  })

  it('ignores a file selection for another changes resource', async () => {
    const first = status('D:\\workspace\\first.ts')
    h.statuses = [first]
    await render(7)
    await act(async () =>
      requestChangesNavigation({ path: 'D:\\workspace\\other.ts', resourceId: 99 })
    )

    expect(container.querySelector('[data-testid="diff"]')?.getAttribute('data-path')).toBe(
      first.path
    )
  })

  it('ignores a workspace root that resolves after switching resources', async () => {
    let resolveFirst: ((value: { entries: never[]; root: string }) => void) | undefined
    let resolveSecond: ((value: { entries: never[]; root: string }) => void) | undefined
    h.readDirectory
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          })
      )

    await render(7)
    await render(8)
    await act(async () => resolveSecond?.({ entries: [], root: 'D:\\second' }))
    expect(h.useGitDecorations).toHaveBeenLastCalledWith(8, 'D:\\second', {
      active: false,
      includeIgnored: false,
      preloadInactive: true
    })

    await act(async () => resolveFirst?.({ entries: [], root: 'D:\\stale' }))
    expect(h.useGitDecorations).toHaveBeenLastCalledWith(8, 'D:\\second', {
      active: false,
      includeIgnored: false,
      preloadInactive: true
    })
  })
})
