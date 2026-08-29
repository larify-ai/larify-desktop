// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchActivationProvider } from '../../../../src/renderer/src/app/workbench/workbench-activation'

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
  inspectFile: vi.fn(async (path: string) => ({ binary: false, mime: 'text/plain', path })),
  invoke: vi.fn(async () => 73),
  revealDirectory: vi.fn(async (path: string) => path),
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
    revealDirectory: h.revealDirectory,
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

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: { inspectFile: h.inspectFile }
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
    h.inspectFile.mockClear()
    h.inspectFile.mockImplementation(async (_resourceId: number, path: string) => ({
      binary: false,
      mime: /\.html?$/i.test(path) ? 'text/html' : 'text/plain',
      path
    }))
    h.revealFile.mockClear()
    h.revealDirectory.mockClear()
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

  const render = async (active = true, providerActive?: boolean): Promise<void> => {
    const view = createElement(WorkspaceView, {
      active,
      resourceId: 42,
      sessionId: 'session-a',
      updateTab: vi.fn()
    })
    await act(async () => {
      root.render(
        providerActive === undefined
          ? view
          : createElement(WorkbenchActivationProvider, { active: providerActive }, view)
      )
    })
  }

  const openFile = async (path: string, hash?: string): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: { kind: 'file' as const, path, hash, resourceId: 42 }
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

  it('schedules preview preloading while idle and cancels it on unmount', async () => {
    const idleCallbacks: IdleRequestCallback[] = []
    const cancelIdle = vi.fn()
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      return 17
    })
    vi.stubGlobal('cancelIdleCallback', cancelIdle)

    await render()

    expect(idleCallbacks).toHaveLength(1)
    await act(async () => root.unmount())
    expect(cancelIdle).toHaveBeenCalledWith(17)
    root = createRoot(container)
  })

  it('reveals a directory navigation without opening a file preview', async () => {
    await render()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: {
            kind: 'directory',
            path: 'E:\\outside\\folder',
            resourceId: 42
          }
        })
      )
      await Promise.resolve()
    })

    expect(h.revealDirectory).toHaveBeenCalledWith('E:\\outside\\folder')
    expect(h.treeProps?.revealPath).toBe('E:\\outside\\folder')
    expect(h.treeProps?.revealDirectory).toBe(true)
    expect(h.filePreviewProps).toBeNull()
  })

  it('does not show file actions for a directory whose name looks like a file', async () => {
    await render()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: {
            kind: 'directory',
            path: 'E:\\outside\\docs.md',
            resourceId: 42
          }
        })
      )
      await Promise.resolve()
    })

    expect(container.querySelector('button[aria-label="查看源码"]')).toBeNull()
    expect(container.querySelector('button[aria-label="在内置浏览器中打开"]')).toBeNull()
  })

  it('clears an existing file preview when a directory is revealed', async () => {
    await render()
    await openFile('README.md')
    expect(container.querySelector('[data-testid="preview"]')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: {
            kind: 'directory',
            path: 'D:\\workspace\\docs',
            resourceId: 42
          }
        })
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="preview"]')).toBeNull()
    expect(container.querySelector('[data-testid="empty"]')).not.toBeNull()
    expect(h.treeProps?.revealDirectory).toBe(true)
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
    })
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-animation', {
          detail: { animating: false, visible: true }
        })
      )
    })

    expect(h.filePreviewProps?.active).toBe(true)
  })

  it('reactivates a file preview through the workbench activation provider', async () => {
    const respondWithVisibleState = (): void => {
      window.dispatchEvent(
        new CustomEvent('larify:workbench-animation', {
          detail: { animating: false, visible: true }
        })
      )
    }
    window.addEventListener('larify:workbench-state-request', respondWithVisibleState)

    await render(true, false)
    await openFile('file.ts')
    expect(h.filePreviewProps?.active).toBe(false)

    await render(true, true)
    expect(h.filePreviewProps?.active).toBe(true)

    window.removeEventListener('larify:workbench-state-request', respondWithVisibleState)
  })

  it('shows HTML source and opens it in the browser only from the toolbar action', async () => {
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
    expect(h.filePreviewProps).toMatchObject({
      path: 'D:\\workspace\\site/index.html'
    })
    expect(h.invoke).not.toHaveBeenCalledWith(
      'resource:create',
      'browser',
      'session-a',
      expect.anything()
    )
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
    expect(h.filePreviewProps).toMatchObject({ path: 'D:\\workspace\\site/index.html' })
    window.removeEventListener('larify:workbench-select-resource', selected)
  })

  it.each([
    ['application/pdf', true, 'manual.pdf'],
    ['image/png', true, 'image.png'],
    ['audio/mpeg', true, 'sound.mp3'],
    ['video/mp4', true, 'video.mp4']
  ])('routes %s files directly to the browser', async (mime, binary, name) => {
    h.inspectFile.mockResolvedValueOnce({ binary, mime, path: `D:\\workspace\\${name}` })
    await render()

    await openFile(name)

    expect(h.invoke).toHaveBeenCalledWith('resource:create', 'browser', 'session-a', {
      url: `D:\\workspace\\${name}`
    })
    expect(h.filePreviewProps).toBeNull()
  })

  it('keeps textual TypeScript in the source preview when its extension maps to video/mp2t', async () => {
    h.inspectFile.mockResolvedValueOnce({
      binary: false,
      mime: 'video/mp2t',
      path: 'D:\\workspace\\source.ts'
    })
    await render()

    await openFile('source.ts')

    expect(h.invoke).not.toHaveBeenCalledWith(
      'resource:create',
      'browser',
      expect.anything(),
      expect.anything()
    )
    expect(h.filePreviewProps).toMatchObject({
      descriptor: { binary: false, mime: 'video/mp2t', path: 'D:\\workspace\\source.ts' },
      path: 'D:\\workspace\\source.ts'
    })
  })

  it('lets the preview surface an inspection failure instead of keeping the previous file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await render()
    await openFile('first.ts')
    h.inspectFile.mockRejectedValueOnce(new Error('inspection failed'))

    await openFile('missing.ts')

    expect(h.filePreviewProps).toMatchObject({
      descriptor: undefined,
      path: 'D:\\workspace\\missing.ts'
    })
  })

  it('only handles Markdown link events addressed to its workspace', async () => {
    await render()
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: { kind: 'file', path: 'ignored.md', resourceId: 99 }
        })
      )
      await Promise.resolve()
    })
    expect(h.revealFile).not.toHaveBeenCalled()

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: { kind: 'file', hash: 'install', path: 'guide.md', resourceId: 42 }
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
        new CustomEvent('larify:workspace-navigation', {
          detail: { kind: 'file', path: 'first.md', resourceId: 42 }
        })
      )
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: { kind: 'file', path: 'second.md', resourceId: 42 }
        })
      )
    })
    await act(async () => second.resolve('D:\\workspace\\second.md'))
    await act(async () => first.resolve('D:\\workspace\\first.md'))

    expect(h.filePreviewProps?.path).toBe('D:\\workspace\\second.md')
  })

  it('keeps the latest file when an older directory reveal finishes last', async () => {
    const directory = deferred<string>()
    h.revealDirectory.mockReturnValueOnce(directory.promise)
    await render()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: { kind: 'directory', path: 'D:\\workspace\\folder', resourceId: 42 }
        })
      )
    })
    await openFile('latest.md')
    await act(async () => directory.resolve('D:\\workspace\\folder'))

    expect(h.filePreviewProps?.path).toBe('D:\\workspace\\latest.md')
    expect(h.treeProps?.revealDirectory).toBe(false)
  })

  it('keeps the latest directory when an older file reveal finishes last', async () => {
    const file = deferred<string>()
    h.revealFile.mockReturnValueOnce(file.promise)
    await render()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: { kind: 'file', path: 'old.md', resourceId: 42 }
        })
      )
    })
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('larify:workspace-navigation', {
          detail: {
            kind: 'directory',
            path: 'D:\\workspace\\latest-folder',
            resourceId: 42
          }
        })
      )
      await Promise.resolve()
    })
    await act(async () => file.resolve('D:\\workspace\\old.md'))

    expect(container.querySelector('[data-testid="preview"]')).toBeNull()
    expect(h.treeProps?.revealPath).toBe('D:\\workspace\\latest-folder')
    expect(h.treeProps?.revealDirectory).toBe(true)
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
          new CustomEvent('larify:workspace-navigation', {
            detail: { kind: 'file', hash: 'install', path: 'README.md', resourceId: 42 }
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

})
