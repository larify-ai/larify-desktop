// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const h = vi.hoisted(() => ({
  actions: null as ReactNode,
  entries: [] as Record<string, unknown>[],
  filePreviewProps: null as Record<string, unknown> | null,
  invoke: vi.fn(async () => 73),
  revealFile: vi.fn(async (path: string) => `D:\\workspace\\${path}`),
  treeProps: null as Record<string, unknown> | null
}))

vi.mock('@renderer/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props, children)
}))

vi.mock('../../../../src/extensions/workspace/renderer/explorer/use-workspace-explorer', () => ({
  useWorkspaceExplorer: () => ({
    entries: h.entries,
    loadDirectory: vi.fn(),
    revealFile: h.revealFile,
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
  workspaceNavigatorDefaultWidth: 260,
  WorkspaceLayout: ({ children, navigator }: { children: ReactNode; navigator: ReactNode }) =>
    createElement(
      'div',
      { className: 'split-view-view', 'data-testid': 'layout' },
      navigator,
      h.actions,
      children
    )
}))

vi.mock('../../../../src/renderer/src/app/workbench/workbench-tab-actions', () => ({
  useWorkbenchTabActions: (actions: ReactNode) => {
    h.actions = actions
  }
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

describe('WorkspaceView', () => {
  let container: HTMLDivElement
  let root: Root
  let frames: FrameRequestCallback[]

  beforeEach(() => {
    h.actions = null
    h.filePreviewProps = null
    h.invoke.mockClear()
    h.revealFile.mockClear()
    h.treeProps = null
    Object.assign(window, { bridge: { invoke: h.invoke } })
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
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

  const openFile = async (path: string): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-markdown-open-file', {
          detail: { path, resourceId: 42 }
        })
      )
      await Promise.resolve()
    })
  }

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
      await openFile('file.ts')
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

  it('shows file controls and opens HTML in the built-in browser', async () => {
    const selected = vi.fn()
    window.addEventListener('larify:workbench-select-resource', selected)
    await render()
    await openFile('docs/notes.md')

    expect(container.querySelector('[data-workspace-navigator-toggle]')).not.toBeNull()
    expect(h.filePreviewProps?.mode).toBe('preview')
    const treeEntries = h.treeProps?.entries
    const source = container.querySelector<HTMLButtonElement>('button[aria-label="查看源码"]')!
    await act(async () => source.click())
    expect(h.filePreviewProps?.mode).toBe('source')
    expect(h.treeProps?.entries).toBe(treeEntries)
    expect(container.querySelector('button[aria-label="阅读预览"]')).not.toBeNull()

    await openFile('site/index.html')
    const open = container.querySelector<HTMLButtonElement>(
      'button[aria-label="在内置浏览器中打开"]'
    )!
    await act(async () => open.click())
    expect(h.invoke).toHaveBeenCalledWith('resource:create', 'browser', 'session-a', {
      url: 'D:\\workspace\\site/index.html'
    })
    expect((selected.mock.calls[0][0] as CustomEvent).detail).toEqual({
      rendererId: 'browser',
      resourceId: 73,
      sessionId: 'session-a'
    })
    expect(h.filePreviewProps?.mode).toBeUndefined()
    window.removeEventListener('larify:workbench-select-resource', selected)
  })

  it('only handles Markdown link events addressed to its workspace', async () => {
    await render()
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-markdown-open-file', {
          detail: { path: 'ignored.md', resourceId: 99 }
        })
      )
      await Promise.resolve()
    })
    expect(h.revealFile).not.toHaveBeenCalled()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-markdown-open-file', {
          detail: { hash: 'install', path: 'guide.md', resourceId: 42 }
        })
      )
      await Promise.resolve()
    })
    expect(h.revealFile).toHaveBeenCalledWith('guide.md')
    expect(h.filePreviewProps).toMatchObject({ target: { hash: 'install' } })

    await openFile('other.md')
    expect(h.filePreviewProps?.target).toBeUndefined()
  })

  it('does not consume review rounds that belong to the changes view', async () => {
    await render()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:review-round', {
          detail: {
            files: [{ additions: 1, deletions: 0, patch: 'patch', path: 'changed.ts' }],
            resourceId: 42,
            selectedPath: 'changed.ts'
          }
        })
      )
      await Promise.resolve()
    })

    expect(h.revealFile).not.toHaveBeenCalled()
    expect(h.filePreviewProps).toBeNull()
  })

  it('keeps the latest file when asynchronous reveals finish out of order', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    h.revealFile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await render()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-markdown-open-file', {
          detail: { path: 'first.md', resourceId: 42 }
        })
      )
      window.dispatchEvent(
        new CustomEvent('larify:workspace-markdown-open-file', {
          detail: { path: 'second.md', resourceId: 42 }
        })
      )
    })
    await act(async () => second.resolve('D:\\workspace\\second.md'))
    await act(async () => first.resolve('D:\\workspace\\first.md'))

    expect(h.filePreviewProps?.path).toBe('D:\\workspace\\second.md')
  })

  it('offers reading and source modes for the .markdown extension', async () => {
    await render()
    await openFile('notes.markdown')

    expect(h.filePreviewProps?.mode).toBe('preview')
    expect(container.querySelector('button[aria-label="查看源码"]')).not.toBeNull()
  })

  it('replays navigation when the same file and hash are selected again', async () => {
    await render()
    const navigate = async (): Promise<void> => {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('larify:workspace-markdown-open-file', {
            detail: { hash: 'install', path: 'README.md', resourceId: 42 }
          })
        )
        await Promise.resolve()
      })
    }

    await navigate()
    const firstPreview = container.querySelector('[data-testid="preview"]')
    const firstTarget = h.filePreviewProps?.target
    await navigate()

    expect(container.querySelector('[data-testid="preview"]')).toBe(firstPreview)
    expect(h.filePreviewProps).toMatchObject({ target: { hash: 'install' } })
    expect(h.filePreviewProps?.target).not.toBe(firstTarget)
  })

  it('selects only the latest browser when creations finish out of order', async () => {
    const first = deferred<number>()
    const second = deferred<number>()
    const selected = vi.fn()
    h.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    window.addEventListener('larify:workbench-select-resource', selected)
    await render()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-markdown-open-external', {
          detail: { resourceId: 42, url: 'https://first.example' }
        })
      )
      window.dispatchEvent(
        new CustomEvent('larify:workspace-markdown-open-external', {
          detail: { resourceId: 42, url: 'https://second.example' }
        })
      )
    })
    await act(async () => second.resolve(2))
    await act(async () => first.resolve(1))

    expect(selected).toHaveBeenCalledOnce()
    expect((selected.mock.calls[0][0] as CustomEvent).detail.resourceId).toBe(2)
    window.removeEventListener('larify:workbench-select-resource', selected)
  })
})
