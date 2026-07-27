// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const editorClient = vi.hoisted(() => ({
  onActive: vi.fn(() => vi.fn()),
  onReveal: vi.fn(() => vi.fn()),
  open: vi.fn().mockResolvedValue(undefined),
  openDiff: vi.fn().mockResolvedValue(undefined),
  openHighlightedDiff: vi.fn().mockResolvedValue(undefined),
  prepare: vi.fn().mockResolvedValue(undefined),
  state: vi.fn().mockResolvedValue({ activeFile: null }),
  theme: vi.fn().mockResolvedValue(undefined)
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' })
}))

vi.mock('@renderer/components/ui/resizable', () => ({
  ResizableHandle: () => null,
  ResizablePanel: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  ResizablePanelGroup: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children)
}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-editor-client', () => ({
  workspaceEditorClient: editorClient
}))

vi.mock('../../../../src/extensions/workspace/renderer/use-git-decorations', () => ({
  useGitDecorations: () => ({ available: true, decorations: new Map(), statuses: [] })
}))

vi.mock('../../../../src/extensions/workspace/renderer/use-workspace-explorer', () => ({
  useWorkspaceExplorer: () => ({
    entries: [],
    loadDirectory: vi.fn(),
    revealFile: vi.fn(),
    root: 'D:\\workspace'
  })
}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-editor-viewport', () => ({
  WorkspaceEditorViewport: () => null
}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-tree', () => ({
  WorkspaceTree: ({
    changesOnly,
    onOpen,
    onToggleView,
    revealPath
  }: {
    changesOnly: boolean
    onOpen(file: string): void
    onToggleView(): void
    revealPath?: string | null
  }) =>
    createElement(
      'div',
      {
        'data-changes-only': String(changesOnly),
        'data-reveal-path': revealPath ?? ''
      },
      createElement('button', { onClick: () => onOpen('D:\\workspace\\file.ts') }, 'open'),
      createElement('button', { onClick: onToggleView }, 'toggle')
    )
}))

import { WorkspaceView } from '../../../../src/extensions/workspace/renderer/workspace-view'

describe('WorkspaceView', () => {
  let root: Root

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    editorClient.openDiff.mockResolvedValue(undefined)
    editorClient.state.mockResolvedValue({ activeFile: null })
  })

  it('prepares the editor as soon as the workspace is available', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(WorkspaceView)))

    expect(editorClient.theme).not.toHaveBeenCalled()
    expect(editorClient.prepare).toHaveBeenCalledWith('D:\\workspace')
    act(() => root.unmount())
  })

  it('disposes editor event listeners after unmount', async () => {
    const disposeActive = vi.fn()
    const disposeReveal = vi.fn()
    editorClient.onActive.mockReturnValueOnce(disposeActive)
    editorClient.onReveal.mockReturnValueOnce(disposeReveal)
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(WorkspaceView)))
    act(() => root.unmount())

    expect(disposeActive).toHaveBeenCalledOnce()
    expect(disposeReveal).toHaveBeenCalledOnce()
  })

  it('opens regular files in the global view and allows retrying after a failure', async () => {
    editorClient.open.mockRejectedValueOnce(new Error('failed'))
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(WorkspaceView)))

    await act(async () => {
      container.querySelector('button')?.click()
    })
    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(editorClient.open).toHaveBeenCalledTimes(2)
    expect(editorClient.openDiff).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('opens diffs in the changes view', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(WorkspaceView)))
    const buttons = container.querySelectorAll('button')

    await act(async () => buttons[1]?.click())
    await act(async () => buttons[0]?.click())

    expect(editorClient.openDiff).toHaveBeenCalledWith(
      'D:\\workspace',
      'D:\\workspace\\file.ts'
    )
    expect(editorClient.open).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('opens a review card in the changes view and highlights its full workspace file', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(WorkspaceView)))

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:review-round', {
          detail: {
            files: [
              {
                additions: 1,
                deletions: 0,
                patch: '@@ -1 +1 @@',
                path: 'src\\file.ts'
              }
            ],
            selectedPath: 'src\\file.ts'
          }
        })
      )
    })

    expect(editorClient.openHighlightedDiff).toHaveBeenCalledWith(
      'D:\\workspace',
      'D:\\workspace\\src\\file.ts',
      '@@ -1 +1 @@'
    )
    const tree = container.querySelector('[data-changes-only]')
    expect(tree?.getAttribute('data-changes-only')).toBe('true')
    expect(tree?.getAttribute('data-reveal-path')).toBe('D:\\workspace\\src\\file.ts')
    act(() => root.unmount())
  })
})
