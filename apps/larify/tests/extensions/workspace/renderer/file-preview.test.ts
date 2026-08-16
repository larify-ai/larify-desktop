// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { RendererRegistryProvider } from '../../../../src/renderer/src/app/registry/renderer-registry-provider'
import {
  PreviewRegistry,
  previewRegistryToken,
  type PreviewRendererProps
} from '../../../../src/renderer/src/app/registry/file-previews'

const workspace = vi.hoisted(() => ({
  inspectFile: vi.fn(),
  listener: undefined as ((directory: string, changedPath: string) => void) | undefined,
  readFile: vi.fn()
}))

function deferred<T>(): {
  promise: Promise<T>
  reject(reason: unknown): void
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@monaco-editor/react', () => ({
  default: ({ path, value }: { path: string; value: string }) =>
    createElement('pre', { 'data-model-path': path }, value)
}))

vi.mock('monaco-editor/editor/editor.api', () => ({
  Uri: {
    file: (path: string) => ({ toString: () => `file://${path.replaceAll('\\', '/')}` })
  }
}))

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

vi.mock('../../../../src/extensions/workspace/renderer/preview/monaco', () => ({}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: {
    inspectFile: (resourceId: number, path: string) => workspace.inspectFile(resourceId, path),
    onDidChange: (
      _resourceId: number,
      listener: (directory: string, changedPath: string) => void
    ) => {
      workspace.listener = listener
      return () => {
        if (workspace.listener === listener) workspace.listener = undefined
      }
    },
    readFile: (resourceId: number, path: string) => workspace.readFile(resourceId, path)
  }
}))

import { FilePreview } from '../../../../src/extensions/workspace/renderer/preview/file-preview'
import { MonacoPreview } from '../../../../src/extensions/workspace/renderer/preview/monaco-preview'

describe('FilePreview', () => {
  let container: HTMLDivElement
  let root: Root
  let registry: Registry

  beforeEach(() => {
    vi.useFakeTimers()
    workspace.inspectFile.mockReset()
    workspace.inspectFile.mockImplementation((_resourceId: number, path: string) =>
      Promise.resolve({ binary: false, mime: 'text/plain', path })
    )
    workspace.listener = undefined
    workspace.readFile.mockReset()
    container = document.createElement('div')
    root = createRoot(container)
    registry = new Registry()
    const previews = new PreviewRegistry()
    previews.register({ component: MonacoPreview, supports: () => true })
    registry.register(previewRegistryToken, previews)
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('reloads only when the open file changes', async () => {
    workspace.readFile.mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(FilePreview, {
            active: true,
            animating: false,
            path: 'D:\\workspace\\src\\file.ts',
            resourceId: 7
          })
        )
      )
    })
    expect(container.textContent).toBe('first')

    act(() => workspace.listener?.('D:\\workspace\\src', 'D:\\workspace\\src\\other.ts'))
    await act(async () => vi.advanceTimersByTime(100))
    expect(workspace.readFile).toHaveBeenCalledTimes(1)

    act(() => workspace.listener?.('D:\\workspace\\src', 'D:\\workspace\\src\\file.ts'))
    await act(async () => vi.advanceTimersByTime(100))

    expect(workspace.readFile).toHaveBeenCalledTimes(2)
    expect(container.textContent).toBe('second')
  })

  it('uses a file URI for the Monaco model', async () => {
    workspace.readFile.mockResolvedValue('content')
    await renderPreview('D:\\workspace\\src\\file.ts')

    expect(container.querySelector('pre')?.dataset.modelPath).toBe(
      'file://D:/workspace/src/file.ts'
    )
  })

  it('debounces consecutive file changes', async () => {
    workspace.readFile.mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    await renderPreview('D:\\workspace\\src\\file.ts')

    act(() => {
      workspace.listener?.('', 'D:\\workspace\\src\\file.ts')
      workspace.listener?.('', 'd:\\workspace\\src\\file.ts')
    })
    await act(async () => vi.advanceTimersByTime(99))
    expect(workspace.readFile).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTime(1))
    expect(workspace.readFile).toHaveBeenCalledTimes(2)
    expect(container.textContent).toBe('second')
  })

  it('ignores a stale read after switching files', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    workspace.readFile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    await renderPreview('D:\\workspace\\first.ts')
    await renderPreview('D:\\workspace\\second.ts')
    await act(async () => second.resolve('second'))
    expect(container.textContent).toBe('second')

    await act(async () => first.resolve('stale first'))
    expect(container.textContent).toBe('second')
  })

  it('ignores an older refresh that finishes last', async () => {
    const older = deferred<string>()
    const newer = deferred<string>()
    workspace.readFile
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    await renderPreview('D:\\workspace\\file.ts')

    act(() => workspace.listener?.('', 'D:\\workspace\\file.ts'))
    await act(async () => vi.advanceTimersByTime(100))
    act(() => workspace.listener?.('', 'D:\\workspace\\file.ts'))
    await act(async () => vi.advanceTimersByTime(100))
    await act(async () => newer.resolve('newer'))
    await act(async () => older.resolve('older'))

    expect(container.textContent).toBe('newer')
  })

  it('recovers when the file changes after a read error', async () => {
    workspace.readFile.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce('ok')
    await renderPreview('D:\\workspace\\file.ts')
    expect(container.textContent).toBe('read failed')

    act(() => workspace.listener?.('', 'D:\\workspace\\file.ts'))
    await act(async () => vi.advanceTimersByTime(100))
    expect(container.textContent).toBe('ok')
  })

  it('cancels a pending refresh when unmounted', async () => {
    workspace.readFile.mockResolvedValue('first')
    await renderPreview('D:\\workspace\\file.ts')

    act(() => workspace.listener?.('', 'D:\\workspace\\file.ts'))
    act(() => root.unmount())
    await act(async () => vi.advanceTimersByTime(100))

    expect(workspace.readFile).toHaveBeenCalledTimes(1)
    expect(workspace.listener).toBeUndefined()
  })

  it('ignores a stale inspection after switching files', async () => {
    const first = deferred<{ binary: boolean; mime: string; path: string }>()
    const second = deferred<{ binary: boolean; mime: string; path: string }>()
    workspace.inspectFile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    registerPathPreview()

    await renderPreview('D:\\workspace\\first.bin')
    await renderPreview('D:\\workspace\\second.bin')
    await act(async () =>
      second.resolve({ binary: true, mime: 'application/octet-stream', path: 'second' })
    )
    expect(container.textContent).toBe('second')

    await act(async () =>
      first.resolve({ binary: true, mime: 'application/octet-stream', path: 'first' })
    )
    expect(container.textContent).toBe('second')
  })

  it('shows inspection errors and unsupported file types', async () => {
    workspace.inspectFile.mockRejectedValueOnce(new Error('inspect failed'))
    await renderPreview('D:\\workspace\\broken.bin')
    expect(container.textContent).toContain('inspect failed')

    registry = new Registry()
    registry.register(previewRegistryToken, new PreviewRegistry())
    await renderPreview('D:\\workspace\\unsupported.bin')
    expect(container.textContent).toContain('text/plain')
  })

  it('forwards preview state and navigation to the selected renderer', async () => {
    const received: PreviewRendererProps[] = []
    registry = new Registry()
    const previews = new PreviewRegistry()
    previews.register({
      component: (props) => {
        received.push(props)
        return createElement('div', null, props.file.path)
      },
      supports: () => true
    })
    registry.register(previewRegistryToken, previews)

    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(FilePreview, {
            active: false,
            animating: true,
            mode: 'preview',
            path: 'D:\\workspace\\file.pdf',
            resourceId: 9,
            target: { hash: 'install' }
          })
        )
      )
    })

    expect(received.at(-1)).toMatchObject({
      active: false,
      animating: true,
      mode: 'preview',
      resourceId: 9,
      target: { hash: 'install' }
    })
  })

  function registerPathPreview(): void {
    registry = new Registry()
    const previews = new PreviewRegistry()
    previews.register({
      component: ({ file }) => createElement('div', null, file.path),
      supports: () => true
    })
    registry.register(previewRegistryToken, previews)
  }

  async function renderPreview(path: string): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          RendererRegistryProvider,
          { registry },
          createElement(FilePreview, {
            active: true,
            animating: false,
            path,
            resourceId: 7
          })
        )
      )
    })
  }
})
