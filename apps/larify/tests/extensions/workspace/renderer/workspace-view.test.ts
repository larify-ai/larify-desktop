// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const editorClient = vi.hoisted(() => ({
  onActive: vi.fn(() => vi.fn()),
  onReveal: vi.fn(() => vi.fn()),
  open: vi.fn().mockResolvedValue(undefined),
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
  useGitDecorations: () => ({ available: true, decorations: new Map() })
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
  WorkspaceTree: ({ onOpen }: { onOpen(file: string): void }) =>
    createElement('button', { onClick: () => onOpen('D:\\workspace\\file.ts') }, 'open')
}))

import { WorkspaceView } from '../../../../src/extensions/workspace/renderer/workspace-view'

describe('WorkspaceView', () => {
  let root: Root

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    editorClient.open.mockResolvedValue(undefined)
    editorClient.state.mockResolvedValue({ activeFile: null })
  })

  it('warms Monaco after the workspace becomes idle', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(WorkspaceView)))

    expect(editorClient.theme).not.toHaveBeenCalled()
    expect(editorClient.prepare).not.toHaveBeenCalled()

    await act(async () => vi.runOnlyPendingTimersAsync())

    expect(editorClient.prepare).toHaveBeenCalledWith('D:\\workspace')
    expect(editorClient.theme).toHaveBeenCalledWith('light')
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

  it('allows retrying the same file after an open failure', async () => {
    editorClient.open.mockRejectedValueOnce(new Error('failed'))
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(WorkspaceView)))

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(editorClient.open).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })
})
