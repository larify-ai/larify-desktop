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
  props: vi.fn(),
  readFile: vi.fn()
}))

vi.mock('file-type', () => ({ fileTypeFromBuffer: harness.detectType }))

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: (props: unknown) => {
    harness.props(props)
    return createElement('div', { 'data-testid': 'diff-editor' })
  }
}))
vi.mock('monaco-editor/editor/editor.api', () => ({
  editor: { ShowLightbulbIconMode: { Off: 'off' } },
  Uri: {
    file: (path: string) => ({
      toString: () => `file:${path}`,
      with: ({ scheme }: { scheme: string }) => ({ toString: () => `${scheme}:${path}` })
    })
  }
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))
vi.mock('../../../../src/extensions/workspace/renderer/preview/monaco', () => ({
  workspaceMonacoLanguage: (path: string) => (path.endsWith('.ts') ? 'typescript' : 'plaintext'),
  workspaceMonacoTheme: (dark: boolean) =>
    dark ? 'larify-workspace-dark' : 'larify-workspace-light'
}))
vi.mock('../../../../src/extensions/workspace/renderer/git-client', () => ({
  gitClient: { original: harness.original }
}))
vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: { inspectFile: harness.inspectFile, readFile: harness.readFile }
}))

import { MonacoDiff } from '../../../../src/extensions/workspace/renderer/changes/monaco-diff'

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
        modifiedModelPath: 'file:D:\\workspace\\file.ts',
        original: 'before',
        originalLanguage: 'typescript',
        originalModelPath: 'git-original:D:\\workspace\\file.ts',
        options: expect.objectContaining({
          experimental: { useTrueInlineView: true },
          glyphMargin: false,
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
    expect(container.querySelector('[data-diff-mode="unified"]')).not.toBeNull()
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
      expect.objectContaining({ options: expect.objectContaining({ renderSideBySide: true }) })
    )
    await act(async () => root.unmount())
  })

  it('uses an empty modified side for a deleted file', async () => {
    harness.readFile.mockRejectedValue(new Error('ENOENT'))
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

    expect(harness.readFile).toHaveBeenCalledWith(7, 'D:\\workspace\\file.ts')
    expect(harness.props).toHaveBeenLastCalledWith(expect.objectContaining({ modified: '' }))
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

  it('uses an empty original side for a newly added file', async () => {
    harness.original.mockResolvedValue(null)
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

    expect(harness.props).toHaveBeenLastCalledWith(expect.objectContaining({ original: '' }))
    await act(async () => root.unmount())
  })

  it('does not send binary working-tree content to Monaco', async () => {
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
          mode: 'unified',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status({ path: 'D:\\workspace\\image.png' })
        })
      )
      await Promise.resolve()
    })

    expect(container.textContent).toBe('二进制文件无法预览')
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('detects binary content from HEAD for a deleted file', async () => {
    harness.original.mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
    harness.detectType.mockResolvedValue({ ext: 'png', mime: 'image/png' })
    harness.readFile.mockRejectedValue(new Error('ENOENT'))
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

    expect(container.textContent).toBe('二进制文件无法预览')
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

  it('updates the original gutter when switching diff modes', async () => {
    const updateOptions = vi.fn()
    const layout = vi.fn()
    const diffEditor = {
      getOriginalEditor: () => ({ updateOptions }),
      layout
    }
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
    await act(async () => harness.props.mock.lastCall?.[0].onMount(diffEditor))
    expect(updateOptions).toHaveBeenLastCalledWith({ lineDecorationsWidth: 0, lineNumbers: 'off' })

    await act(async () =>
      root.render(
        createElement(MonacoDiff, {
          mode: 'split',
          resourceId: 7,
          root: 'D:\\workspace',
          status: status()
        })
      )
    )
    expect(updateOptions).toHaveBeenLastCalledWith({ lineDecorationsWidth: 10, lineNumbers: 'on' })
    expect(layout).toHaveBeenCalled()
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
