// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileStatusResult } from 'simple-git'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const harness = vi.hoisted(() => ({
  inspectFile: vi.fn(),
  original: vi.fn(),
  previewProps: vi.fn(),
  props: vi.fn(),
  readFile: vi.fn()
}))

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
import { classifyWholeFile } from '../../../../src/extensions/workspace/renderer/changes/whole-file'

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

// 整文件判定的全部边界。曾出现过一次重构回归：漏掉 modified 为空的判断后，
// 「普通修改」被误判成 'removed'，整块文件被涂成删除色。这里逐条锁死。
describe('classifyWholeFile', () => {
  it.each([
    ['普通修改', 'unified', 'before', 'after', null],
    ['新增文件', 'unified', '', 'after', 'added'],
    ['删除文件', 'unified', 'before', '', 'removed'],
    ['两侧皆空', 'unified', '', '', null],
    ['split 普通修改', 'split', 'before', 'after', null],
    ['split 新增', 'split', '', 'after', null],
    ['split 删除', 'split', 'before', '', null]
  ] as const)('%s', (_label, mode, original, modified, expected) => {
    expect(classifyWholeFile(mode, original, modified)).toBe(expected)
  })

  it('treats only a truly empty side as a whole-file change', () => {
    // 空白字符不等于空：只有长度为 0 才算整文件变更。
    expect(classifyWholeFile('unified', '\n', 'after')).toBe(null)
    expect(classifyWholeFile('unified', 'before', '\n')).toBe(null)
  })
})

describe('MonacoDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('renders a deleted file in a plain editor highlighted as removed', async () => {
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
    // The deleted content is shown by a plain editor (not the diff editor), so
    // it cannot be mistaken for an insertion.
    expect(harness.props).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ original: expect.anything() })
    )
    expect(harness.props).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'before' }))
    expect(container.querySelector('[data-testid="added-editor"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    // The direction is carried by the class the highlight rule targets; the
    // whole-file branch intentionally carries no data-*-empty attributes.
    expect(container.querySelector('.workspace-removed-only-editor')).not.toBeNull()
    expect(container.querySelector('.workspace-added-only-editor')).toBeNull()

    const removedEditorProps = harness.props.mock.lastCall?.[0] as {
      onMount(editor: unknown): void
    }
    const range = { endColumn: 1, endLineNumber: 2, startColumn: 1, startLineNumber: 1 }
    const createDecorationsCollection = vi.fn()
    removedEditorProps.onMount({
      createDecorationsCollection,
      getModel: () => ({ getFullModelRange: () => range })
    })
    expect(createDecorationsCollection).toHaveBeenCalledWith([
      {
        options: { className: 'workspace-removed-line', isWholeLine: true },
        range
      }
    ])
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
    expect(container.querySelector('[data-testid="diff-editor"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="added-editor"]')).toBeNull()
    // split 模式仍走 diff 编辑器，原侧（红）保留。
    expect(container.querySelector('.workspace-removed-only-editor')).toBeNull()
    await act(async () => root.unmount())
  })

  // 整文件分支不带 data-*-empty：这些属性只驱动 `.monaco-diff-editor` 作用域内的规则，
  // 而整文件渲染根本不含 diff 编辑器。方向改由 `workspace-{kind}-only-editor` 类名承载。
  it.each([
    ['added', { index: 'A', working_dir: ' ' }, true, '.workspace-added-only-editor'],
    ['deleted', { working_dir: 'D' }, false, '.workspace-removed-only-editor']
  ])(
    'marks a %s file with its whole-file class and no dead data attributes',
    async (_label, overrides, originalMissing, expectedClass) => {
      if (originalMissing) harness.original.mockResolvedValue(null)
      const container = document.createElement('div')
      const root = createRoot(container)

      await act(async () => {
        root.render(
          createElement(MonacoDiff, {
            mode: 'unified',
            resourceId: 7,
            root: 'D:\\workspace',
            status: status(overrides as Partial<FileStatusResult>)
          })
        )
        await Promise.resolve()
      })

      const preview = container.querySelector('.workspace-file-preview')
      expect(preview?.matches(expectedClass)).toBe(true)
      // 死属性必须不存在，避免再次引入“写了没人读”的噪音。
      expect(preview?.hasAttribute('data-added-only')).toBe(false)
      expect(preview?.hasAttribute('data-deleted-only')).toBe(false)
      expect(preview?.hasAttribute('data-original-empty')).toBe(false)
      expect(preview?.hasAttribute('data-modified-empty')).toBe(false)
      await act(async () => root.unmount())
    }
  )

  it('marks a normal modified file as neither added-only nor deleted-only', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ working_dir: 'M' })
        })
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="diff-editor"]')).not.toBeNull()
    expect(container.querySelector('.workspace-removed-only-editor')).toBeNull()
    expect(container.querySelector('.workspace-added-only-editor')).toBeNull()
    // diff 分支保留 data-*-empty（CSS 的幻影行规则依赖它们）。
    expect(container.querySelector('[data-modified-empty="false"]')).not.toBeNull()
    expect(container.querySelector('[data-original-empty="false"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('falls back to the diff editor when both sides are empty', async () => {
    harness.original.mockResolvedValue(null)
    harness.readFile.mockResolvedValue('')
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

    // 两侧都空既不是新增也不是删除，不能落入整文件着色分支。
    expect(container.querySelector('[data-testid="diff-editor"]')).not.toBeNull()
    expect(container.querySelector('.workspace-removed-only-editor')).toBeNull()
    expect(container.querySelector('.workspace-added-only-editor')).toBeNull()
    await act(async () => root.unmount())
  })

  it('empties the original side for an added file with empty content', async () => {
    harness.original.mockResolvedValue(null)
    harness.readFile.mockResolvedValue('fresh\n')
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ index: 'A', working_dir: ' ' })
        })
      )
      await Promise.resolve()
    })

    const addedEditorProps = harness.props.mock.lastCall?.[0] as {
      onMount(editor: unknown): void
    }
    const range = { endColumn: 1, endLineNumber: 2, startColumn: 1, startLineNumber: 1 }
    const createDecorationsCollection = vi.fn()
    addedEditorProps.onMount({
      createDecorationsCollection,
      getModel: () => ({ getFullModelRange: () => range })
    })
    expect(createDecorationsCollection).toHaveBeenCalledWith([
      { options: { className: 'workspace-added-line', isWholeLine: true }, range }
    ])
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
    expect(harness.props).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'before' }))
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
    expect(container.querySelector('.workspace-added-only-editor')).not.toBeNull()
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

  it('reads a deleted text file from HEAD without an unhandled rejection', async () => {
    harness.original.mockResolvedValue(new TextEncoder().encode('before'))
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

    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    expect(container.querySelector('.workspace-removed-only-editor')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('previews an XML-based robot file as a text diff instead of a binary one', async () => {
    harness.original.mockResolvedValue(
      new TextEncoder().encode('<?xml version="1.0"?>\n<robot name="demo"/>')
    )
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(MonacoDiff, {
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ path: 'D:\\workspace\\robot.urdf', working_dir: 'D' })
        })
      )
      await Promise.resolve()
    })

    // `<?xml ...?>` 开头的纯文本按内容判（无 NUL 字节）是文本：不能换成二进制预览。
    expect(container.querySelector('[data-testid="file-preview"]')).toBeNull()
    expect(container.textContent).not.toBe('文件已删除')
    await act(async () => root.unmount())
  })

  it('keeps a text diff when only the HEAD blob is binary but the working tree is text', async () => {
    // HEAD 是被替换掉的旧二进制、工作区已是文本（如二进制→文本 转换）⇒ 不能因 HEAD 是二进制
    // 就丢掉 diff：HEAD 内容只服务于「工作区文件不存在」的回退路径。
    const header = new Uint8Array(16)
    header.set([137, 80, 78, 71, 13, 10, 26, 10])
    harness.original.mockResolvedValue(header)
    harness.inspectFile.mockResolvedValue({
      binary: false,
      mime: 'text/plain',
      path: 'D:\\workspace\\file.ts'
    })
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

    expect(container.querySelector('[data-testid="file-preview"]')).toBeNull()
    expect(container.querySelector('[data-testid="diff-editor"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('detects binary content from HEAD for a deleted file', async () => {
    const header = new Uint8Array(16)
    header.set([137, 80, 78, 71, 13, 10, 26, 10]) // PNG 签名，其后含 NUL 字节
    harness.original.mockResolvedValue(header)
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
