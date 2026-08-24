// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileStatusResult } from 'simple-git'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const harness = vi.hoisted(() => ({
  detectType: vi.fn(),
  inspectFile: vi.fn(),
  original: vi.fn(),
  previewProps: vi.fn(),
  props: vi.fn(),
  readFile: vi.fn()
}))

vi.mock('file-type', () => ({ fileTypeFromBuffer: harness.detectType }))

vi.mock('@monaco-editor/react', () => ({
  default: (props: unknown) => {
    harness.props(props)
    return createElement('div', { 'data-testid': 'added-editor' })
  },
  DiffEditor: (props: unknown) => {
    harness.props(props)
    return createElement('div', { 'data-testid': 'diff-editor' })
  }
}))
vi.mock('monaco-editor/editor/editor.api', () => ({
  editor: {
    ShowLightbulbIconMode: { Off: 'off' }
  },
  Uri: {
    file: (path: string) => {
      const uri = (scheme = 'file', query = ''): unknown => ({
        toString: () => `${scheme}:${path}${query ? `?${query}` : ''}`,
        with: (change: { query?: string; scheme?: string }) =>
          uri(change.scheme ?? scheme, change.query ?? query)
      })
      return uri()
    }
  }
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))
vi.mock('../../../../src/extensions/workspace/renderer/preview/monaco', () => ({
  workspaceMonacoGutterOptions: {
    folding: false,
    glyphMargin: false,
    lineDecorationsWidth: 10,
    lineNumbers: 'on',
    lineNumbersMinChars: 4
  },
  workspaceMonacoLanguage: (path: string) => (path.endsWith('.ts') ? 'typescript' : 'plaintext'),
  workspaceMonacoTheme: (dark: boolean) =>
    dark ? 'larify-workspace-dark' : 'larify-workspace-light'
}))
vi.mock('../../../../src/extensions/workspace/renderer/preview/file-preview', () => ({
  FilePreview: (props: unknown) => {
    harness.previewProps(props)
    return createElement('div', { 'data-testid': 'file-preview' })
  }
}))
vi.mock('../../../../src/extensions/workspace/renderer/git-client', () => ({
  gitClient: { original: harness.original }
}))
vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: { inspectFile: harness.inspectFile, readFile: harness.readFile }
}))

import {
  MonacoContentDiff,
  MonacoDiff
} from '../../../../src/extensions/workspace/renderer/changes/monaco-diff'

const setPreviewSize = (container: HTMLElement, width = 900, height = 600): void => {
  const preview = container.querySelector<HTMLElement>('.workspace-file-preview')
  if (!preview) throw new Error('Workspace preview is missing')
  Object.defineProperties(preview, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width }
  })
}

const status = (values: Partial<FileStatusResult> = {}): FileStatusResult => ({
  index: ' ',
  path: 'D:\\workspace\\file.ts',
  working_dir: 'M',
  ...values
})

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('MonacoDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.detectType.mockResolvedValue(undefined)
    harness.inspectFile.mockResolvedValue({
      binary: false,
      mime: 'text/plain',
      path: 'D:\\workspace\\file.ts'
    })
    harness.original.mockResolvedValue(new TextEncoder().encode('before'))
    harness.readFile.mockResolvedValue('after')
  })

  it('loads the HEAD and working-tree contents into Monaco', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          active: true,
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status()
        })
      )
      await Promise.resolve()
    })

    expect(harness.original).toHaveBeenCalledWith('D:\\workspace', 'D:\\workspace\\file.ts')
    expect(harness.readFile).toHaveBeenCalledWith(7, 'D:\\workspace\\file.ts')
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({
        modified: 'after',
        modifiedLanguage: 'typescript',
        modifiedModelPath: 'file:D:\\workspace\\file.ts?7',
        original: 'before',
        originalLanguage: 'typescript',
        originalModelPath: 'git-original:D:\\workspace\\file.ts?7',
        options: expect.objectContaining({
          compactMode: true,
          glyphMargin: false,
          lineDecorationsWidth: 10,
          lineNumbersMinChars: 4,
          lightbulb: { enabled: 'off' },
          renderSideBySide: false,
          useInlineViewWhenSpaceIsLimited: false
        }),
        theme: 'larify-workspace-dark'
      })
    )
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.not.objectContaining({
        keepCurrentModifiedModel: expect.anything(),
        keepCurrentOriginalModel: expect.anything()
      })
    )
    const diffEditorProps = harness.props.mock.lastCall?.[0] as {
      onMount(editor: { layout(dimension?: { height: number; width: number }): void }): void
    }
    const layout = vi.fn()
    setPreviewSize(container)
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    diffEditorProps.onMount({ layout })
    expect(layout).toHaveBeenCalledWith({ height: 600, width: 900 })
    frame.mockRestore()
    expect(container.querySelector('[data-diff-mode="unified"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('defers file reads and Monaco mounting until an inactive diff becomes active', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const selectedStatus = status()
    const render = async (active: boolean): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(MonacoDiff, {
            active,
            mode: 'unified',
            resourceId: 7,
            root: 'D:\\workspace',
            status: selectedStatus
          })
        )
        await Promise.resolve()
      })
    }

    await render(false)
    expect(harness.original).not.toHaveBeenCalled()
    expect(harness.readFile).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()

    await render(true)
    expect(harness.original).toHaveBeenCalledOnce()
    expect(harness.readFile).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-testid="diff-editor"]')).not.toBeNull()

    await render(false)
    await render(true)
    expect(harness.original).toHaveBeenCalledOnce()
    expect(harness.readFile).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })

  it('lays out only while active and again after each reactivation', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })
    const render = async (active: boolean): Promise<void> => {
      await act(async () =>
        root.render(
          createElement(MonacoContentDiff, {
            active,
            mode: 'unified',
            modified: 'after',
            modifiedPath: 'D:\\workspace\\file.ts',
            original: 'before',
            originalPath: 'D:\\workspace\\file.ts'
          })
        )
      )
    }

    await render(false)
    setPreviewSize(container, 960, 640)
    const props = harness.props.mock.lastCall?.[0] as {
      onMount(editor: { layout(dimension?: { height: number; width: number }): void }): void
      options: unknown
    }
    const initialOptions = props.options
    const layout = vi.fn()
    props.onMount({ layout })
    expect(frames).toHaveLength(0)

    await render(true)
    expect((harness.props.mock.lastCall?.[0] as { options: unknown }).options).toBe(initialOptions)
    frames.shift()?.(0)
    expect(layout).toHaveBeenLastCalledWith({ height: 640, width: 960 })

    await render(false)
    await render(true)
    frames.shift()?.(0)
    expect(layout).toHaveBeenCalledTimes(2)

    requestFrame.mockRestore()
    await act(async () => root.unmount())
  })

  it('uses the former path for a rename', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'split',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ from: 'D:\\workspace\\old.ts', index: 'R', working_dir: ' ' })
        })
      )
      await Promise.resolve()
    })

    expect(harness.original).toHaveBeenCalledWith('D:\\workspace', 'D:\\workspace\\old.ts')
    expect(container.querySelector('[data-diff-mode="split"]')).not.toBeNull()
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          compactMode: false,
          glyphMargin: false,
          lineNumbersMinChars: 4,
          renderSideBySide: true
        })
      })
    )
    await act(async () => root.unmount())
  })

  it('uses an empty modified side for a deleted file', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ working_dir: 'D' })
        })
      )
      await Promise.resolve()
    })

    expect(harness.readFile).not.toHaveBeenCalled()
    expect(harness.inspectFile).not.toHaveBeenCalled()
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ modified: 'before', original: '' })
    )
    expect(container.querySelector('[data-deleted-only="true"]')).not.toBeNull()
    expect(container.querySelector('[data-modified-empty="false"]')).not.toBeNull()
    expect(container.querySelector('[data-original-empty="true"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('keeps deleted contents on the original side in split mode', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'split',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ working_dir: 'D' })
        })
      )
      await Promise.resolve()
    })

    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ modified: '', original: 'before' })
    )
    expect(container.querySelector('[data-deleted-only="false"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('isolates review models by scheme and key', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoContentDiff, {
          modelKey: '7',
          mode: 'unified',
          modified: 'after',
          modifiedPath: 'D:\\workspace\\file.ts',
          original: 'before',
          originalPath: 'D:\\workspace\\file.ts',
          scheme: 'review-original'
        })
      )
    })

    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({
        modifiedModelPath: 'review-original-modified:D:\\workspace\\file.ts?7',
        originalModelPath: 'review-original:D:\\workspace\\file.ts?7'
      })
    )
    await act(async () => root.unmount())
  })

  it('gives simultaneous diff tabs distinct Monaco model URIs', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(MonacoContentDiff, {
            modelKey: '3',
            mode: 'unified',
            modified: 'after 3',
            modifiedPath: 'D:\\workspace\\file.ts',
            original: 'before 3',
            originalPath: 'D:\\workspace\\file.ts'
          }),
          createElement(MonacoContentDiff, {
            modelKey: '4',
            mode: 'unified',
            modified: 'after 4',
            modifiedPath: 'D:\\workspace\\file.ts',
            original: 'before 4',
            originalPath: 'D:\\workspace\\file.ts'
          })
        )
      )
    })

    const modelPaths = harness.props.mock.calls.map(([props]) => {
      const value = props as { modifiedModelPath?: string; originalModelPath?: string }
      return [value.originalModelPath, value.modifiedModelPath]
    })
    expect(modelPaths).toEqual([
      ['git-original:D:\\workspace\\file.ts?3', 'file:D:\\workspace\\file.ts?3'],
      ['git-original:D:\\workspace\\file.ts?4', 'file:D:\\workspace\\file.ts?4']
    ])
    expect(new Set(modelPaths.flat()).size).toBe(4)
    await act(async () => root.unmount())
  })

  it('keeps a recreated working file even when its deletion is staged', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ index: 'D', working_dir: '?' })
        })
      )
      await Promise.resolve()
    })

    expect(harness.props).toHaveBeenLastCalledWith(expect.objectContaining({ modified: 'after' }))
    await act(async () => root.unmount())
  })

  it('does not read a file removed by a staged deletion', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ index: 'D', working_dir: ' ' })
        })
      )
      await Promise.resolve()
    })

    expect(harness.readFile).not.toHaveBeenCalled()
    expect(harness.inspectFile).not.toHaveBeenCalled()
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ modified: 'before', original: '' })
    )
    await act(async () => root.unmount())
  })

  it('uses an empty original side for a newly added file', async () => {
    harness.original.mockResolvedValue(null)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          active: true,
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ index: 'A', working_dir: ' ' })
        })
      )
      await Promise.resolve()
    })

    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ folding: false, lineDecorationsWidth: 10 }),
        value: 'after'
      })
    )
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ original: expect.anything() })
    )
    const addedEditorProps = harness.props.mock.lastCall?.[0] as {
      onMount(editor: unknown): void
    }
    const range = { endColumn: 1, endLineNumber: 2, startColumn: 1, startLineNumber: 1 }
    const createDecorationsCollection = vi.fn()
    const layout = vi.fn()
    setPreviewSize(container)
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    addedEditorProps.onMount({
      createDecorationsCollection,
      getModel: () => ({ getFullModelRange: () => range }),
      layout
    })
    expect(createDecorationsCollection).toHaveBeenCalledWith([
      {
        options: { className: 'workspace-added-line', isWholeLine: true },
        range
      }
    ])
    expect(layout).toHaveBeenCalledWith({ height: 600, width: 900 })
    frame.mockRestore()
    expect(container.querySelector('[data-original-empty="true"]')).not.toBeNull()
    expect(container.querySelector('[data-modified-empty="false"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('uses the existing file preview for a binary working-tree file', async () => {
    harness.inspectFile.mockResolvedValue({
      binary: true,
      mime: 'image/png',
      path: 'D:\\workspace\\image.png'
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          active: true,
          animating: true,
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ path: 'D:\\workspace\\image.png' })
        })
      )
      await Promise.resolve()
    })

    expect(harness.previewProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: true,
        animating: true,
        path: 'D:\\workspace\\image.png',
        resourceId: 7
      })
    )
    expect(container.querySelector('[data-testid="file-preview"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('shows binary detection failures instead of leaving an unhandled rejection', async () => {
    harness.detectType.mockRejectedValue(new Error('类型检测失败'))
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status()
        })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toBe('类型检测失败')
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('detects binary content from HEAD for a deleted file', async () => {
    harness.original.mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
    harness.detectType.mockResolvedValue({ ext: 'png', mime: 'image/png' })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ path: 'D:\\workspace\\image.png', working_dir: 'D' })
        })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toBe('文件已删除')
    expect(container.querySelector('[data-testid="file-preview"]')).toBeNull()
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('ignores a stale request after switching files', async () => {
    const stale = deferred<Uint8Array | null>()
    harness.original
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(new TextEncoder().encode('fresh'))
    harness.readFile.mockResolvedValueOnce('stale modified').mockResolvedValueOnce('fresh modified')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () =>
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status()
        })
      )
    )
    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ path: 'D:\\workspace\\fresh.ts' })
        })
      )
      await Promise.resolve()
    })
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ modified: 'fresh modified', original: 'fresh' })
    )

    await act(async () => stale.resolve(new TextEncoder().encode('stale')))
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ modified: 'fresh modified', original: 'fresh' })
    )
    await act(async () => root.unmount())
  })

  it('does not show stale content while switching workspace resources', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const selectedStatus = status()

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: selectedStatus
        })
      )
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="diff-editor"]')).not.toBeNull()

    const pending = deferred<Uint8Array | null>()
    harness.original.mockReturnValueOnce(pending.promise)
    harness.readFile.mockResolvedValueOnce('other workspace')
    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 8,
          root: 'D:\\workspace',
          status: selectedStatus
        })
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    await act(async () => pending.resolve(new TextEncoder().encode('other original')))
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ modified: 'other workspace', original: 'other original' })
    )
    await act(async () => root.unmount())
  })

  it('reloads content when Git refreshes an unchanged status pair', async () => {
    harness.original
      .mockResolvedValueOnce(new TextEncoder().encode('before 1'))
      .mockResolvedValueOnce(new TextEncoder().encode('before 2'))
    harness.readFile.mockResolvedValueOnce('after 1').mockResolvedValueOnce('after 2')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status()
        })
      )
      await Promise.resolve()
    })
    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status()
        })
      )
      await Promise.resolve()
    })

    expect(harness.original).toHaveBeenCalledTimes(2)
    expect(harness.readFile).toHaveBeenCalledTimes(2)
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ modified: 'after 2', original: 'before 2' })
    )
    await act(async () => root.unmount())
  })

  it('shows read failures instead of mounting Monaco', async () => {
    harness.readFile.mockRejectedValue(new Error('读取失败'))
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status()
        })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toBe('读取失败')
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
