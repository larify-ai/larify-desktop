// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  actions: null as ReactNode,
  filePreviewProps: null as Record<string, unknown> | null,
  treeProps: null as Record<string, unknown> | null
}))

vi.mock('@renderer/app/workbench/workbench-tab-actions', () => ({
  useWorkbenchTabActions: (actions: ReactNode) => {
    h.actions = actions
  }
}))

vi.mock('@renderer/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props, children)
}))

vi.mock('../../../../src/extensions/workspace/renderer/explorer/use-workspace-explorer', () => ({
  useWorkspaceExplorer: () => ({
    entries: [],
    loadDirectory: vi.fn(),
    revealFile: vi.fn(async (path: string) => `D:\\workspace\\${path}`),
    root: 'D:\\workspace'
  })
}))

vi.mock('../../../../src/extensions/workspace/renderer/changes/use-git-decorations', () => ({
  useGitDecorations: () => ({ decorations: new Map(), statuses: [] })
}))

vi.mock('../../../../src/extensions/workspace/renderer/explorer/workspace-tree', () => ({
  WorkspaceTree: (props: Record<string, unknown>) => {
    h.treeProps = props
    return createElement('div', { 'data-testid': 'tree' })
  }
}))

vi.mock('../../../../src/extensions/workspace/renderer/layout/workspace-layout', () => ({
  WorkspaceLayout: ({ children, navigator }: { children: ReactNode; navigator: ReactNode }) =>
    createElement(
      'div',
      { className: 'split-view-view', 'data-testid': 'layout' },
      navigator,
      children
    )
}))

vi.mock('../../../../src/extensions/workspace/renderer/preview/empty-file-preview', () => ({
  EmptyFilePreview: () => createElement('div', { 'data-testid': 'empty' })
}))

vi.mock('../../../../src/extensions/workspace/renderer/preview/file-preview', () => ({
  FilePreview: (props: Record<string, unknown>) => {
    h.filePreviewProps = props
    return createElement('div', { 'data-testid': 'preview' })
  }
}))

vi.mock('../../../../src/extensions/workspace/renderer/preview/monaco-preview', () => ({
  MonacoPreview: () => null
}))

import { WorkspaceView } from '../../../../src/extensions/workspace/renderer/workspace-view'
import { setReviewRound } from '../../../../src/extensions/workspace/renderer/changes/review-changes'

describe('WorkspaceView', () => {
  let container: HTMLDivElement
  let root: Root
  let actionsContainer: HTMLDivElement
  let actionsRoot: Root
  let frames: FrameRequestCallback[]

  beforeEach(() => {
    h.actions = null
    h.filePreviewProps = null
    h.treeProps = null
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    container = document.createElement('div')
    actionsContainer = document.createElement('div')
    document.body.append(container, actionsContainer)
    root = createRoot(container)
    actionsRoot = createRoot(actionsContainer)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      actionsRoot.unmount()
    })
    container.remove()
    actionsContainer.remove()
    vi.unstubAllGlobals()
  })

  const render = async (active = true): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(WorkspaceView, {
          active,
          resourceId: 42,
          sessionId: 'session-a',
          updateTab: vi.fn()
        })
      )
    })
  }

  const renderActions = async (): Promise<void> => {
    await act(async () => actionsRoot.render(createElement('div', null, h.actions)))
  }

  it('switches between all files and changed files from the tab action', async () => {
    await render()
    await renderActions()
    expect(h.treeProps?.changesOnly).toBe(false)

    await act(async () => actionsContainer.querySelector('button')!.click())
    await renderActions()

    expect(h.treeProps?.changesOnly).toBe(true)
    expect(actionsContainer.querySelector('button')?.getAttribute('aria-label')).toBe(
      '显示全部文件'
    )
  })

  it('releases a locked preview width after two frames in a permanently narrow pane', async () => {
    await render()
    const pane = container.querySelector<HTMLElement>('[data-testid="layout"]')!
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ width: 100 } as DOMRect)

    act(() => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-animation', {
          detail: { animating: true, visible: true }
        })
      )
    })
    const preview = container.querySelector<HTMLElement>('[data-preview-animating]')!
    expect(preview.style.width).toBe('500px')

    act(() => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-animation', {
          detail: { animating: false, visible: true }
        })
      )
    })
    expect(frames).toHaveLength(1)

    act(() => frames.shift()!(0))
    act(() => frames.shift()!(0))

    expect(preview.style.width).toBe('')
  })

  it('keeps a reviewed file preview inactive until its workbench tab is active and visible', async () => {
    await render(false)
    await act(async () => {
      setReviewRound({
        files: [{ additions: 1, deletions: 0, patch: '', path: 'file.ts' }],
        selectedPath: 'file.ts'
      })
      await Promise.resolve()
    })
    expect(h.filePreviewProps?.active).toBe(false)

    await act(async () => {
      root.render(
        createElement(WorkspaceView, {
          active: true,
          resourceId: 42,
          sessionId: 'session-a',
          updateTab: vi.fn()
        })
      )
      window.dispatchEvent(
        new CustomEvent('larify:workbench-animation', {
          detail: { animating: false, visible: true }
        })
      )
    })

    expect(h.filePreviewProps?.active).toBe(true)
  })
})
