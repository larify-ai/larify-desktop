// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  listener: undefined as ((directory: string, path: string) => void) | undefined,
  readFile: vi.fn(),
  unsubscribe: vi.fn()
}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: {
    onDidChange: vi.fn(
      (_resourceId: number, listener: (directory: string, path: string) => void) => {
        h.listener = listener
        return h.unsubscribe
      }
    ),
    readFile: h.readFile
  }
}))

import { useWorkspaceTextFile } from '../../../../src/extensions/workspace/renderer/preview/use-workspace-text-file'

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

function Probe({
  active = true,
  path,
  resourceId = 7
}: {
  active?: boolean
  path: string
  resourceId?: number
}): React.JSX.Element {
  const state = useWorkspaceTextFile(resourceId, path, active)
  return createElement('div', { 'data-content': state.content, 'data-error': state.error })
}

describe('useWorkspaceTextFile', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    h.listener = undefined
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('loads the file and reports read errors', async () => {
    h.readFile.mockResolvedValueOnce('# Ready')
    await act(async () => {
      root.render(createElement(Probe, { path: 'README.md' }))
      await Promise.resolve()
    })
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('# Ready')

    h.readFile.mockRejectedValueOnce(new Error('Read failed'))
    await act(async () => {
      root.render(createElement(Probe, { path: 'BROKEN.md' }))
      await Promise.resolve()
    })
    expect(container.firstElementChild?.getAttribute('data-error')).toBe('Read failed')
  })

  it('debounces matching changes and ignores unrelated files', async () => {
    h.readFile.mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    await act(async () => {
      root.render(createElement(Probe, { path: 'README.md' }))
      await Promise.resolve()
    })

    h.listener?.('', 'OTHER.md')
    h.listener?.('', 'README.md')
    h.listener?.('', 'README.md')
    await act(async () => vi.advanceTimersByTimeAsync(100))

    expect(h.readFile).toHaveBeenCalledTimes(2)
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('second')
  })

  it('invalidates an in-flight read as soon as the file changes', async () => {
    const stale = deferred<string>()
    const current = deferred<string>()
    h.readFile.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)
    await act(async () => root.render(createElement(Probe, { path: 'README.md' })))

    h.listener?.('', 'README.md')
    await act(async () => stale.resolve('stale'))
    expect(container.firstElementChild?.hasAttribute('data-content')).toBe(false)

    await act(async () => vi.advanceTimersByTimeAsync(100))
    await act(async () => current.resolve('current'))
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('current')
  })

  it('keeps showing the previous content while the next file loads and unsubscribes', async () => {
    const next = deferred<string>()
    h.readFile.mockResolvedValueOnce('first').mockReturnValueOnce(next.promise)
    await act(async () => {
      root.render(createElement(Probe, { path: 'FIRST.md' }))
      await Promise.resolve()
    })

    await act(async () => root.render(createElement(Probe, { path: 'SECOND.md' })))
    // 新内容到达前保留旧内容（避免空白帧闪烁）
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('first')
    expect(h.unsubscribe).toHaveBeenCalledOnce()

    await act(async () => next.resolve('second'))
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('second')
  })

  it('serves a cached file when switching back without re-reading', async () => {
    h.readFile.mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    await act(async () => {
      root.render(createElement(Probe, { path: 'FIRST.md' }))
      await Promise.resolve()
    })
    await act(async () => {
      root.render(createElement(Probe, { path: 'SECOND.md' }))
      await Promise.resolve()
    })

    const calls = h.readFile.mock.calls.length
    await act(async () => root.render(createElement(Probe, { path: 'FIRST.md' })))
    await act(async () => Promise.resolve())
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('first')
    expect(h.readFile.mock.calls.length).toBe(calls)
  })

  it('does not stick to an error when returning to a cached file', async () => {
    h.readFile.mockResolvedValueOnce('first').mockRejectedValueOnce(new Error('Read failed'))
    await act(async () => {
      root.render(createElement(Probe, { path: 'FIRST.md' }))
      await Promise.resolve()
    })
    await act(async () => {
      root.render(createElement(Probe, { path: 'BROKEN.md' }))
      await Promise.resolve()
    })
    expect(container.firstElementChild?.getAttribute('data-error')).toBe('Read failed')

    await act(async () => root.render(createElement(Probe, { path: 'FIRST.md' })))
    await act(async () => Promise.resolve())
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('first')
    expect(container.firstElementChild?.hasAttribute('data-error')).toBe(false)
  })

  it('retries a failed file when switching back to it', async () => {
    h.readFile
      .mockRejectedValueOnce(new Error('Read failed'))
      .mockResolvedValueOnce('other')
      .mockResolvedValueOnce('recovered')
    await act(async () => {
      root.render(createElement(Probe, { path: 'BROKEN.md' }))
      await Promise.resolve()
    })
    expect(container.firstElementChild?.getAttribute('data-error')).toBe('Read failed')

    await act(async () => {
      root.render(createElement(Probe, { path: 'OTHER.md' }))
      await Promise.resolve()
    })
    await act(async () => {
      root.render(createElement(Probe, { path: 'BROKEN.md' }))
      await Promise.resolve()
    })
    expect(h.readFile).toHaveBeenCalledTimes(3)
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('recovered')
    expect(container.firstElementChild?.hasAttribute('data-error')).toBe(false)
  })

  it('does not read an initially inactive file until activation', async () => {
    h.readFile.mockResolvedValueOnce('ready')
    await act(async () => root.render(createElement(Probe, { active: false, path: 'README.md' })))
    expect(h.readFile).not.toHaveBeenCalled()

    await act(async () => {
      root.render(createElement(Probe, { path: 'README.md' }))
      await Promise.resolve()
    })
    expect(h.readFile).toHaveBeenCalledOnce()
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('ready')
  })

  it('reloads once after a loaded file changes while inactive', async () => {
    h.readFile.mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    await act(async () => {
      root.render(createElement(Probe, { path: 'README.md' }))
      await Promise.resolve()
    })
    await act(async () => root.render(createElement(Probe, { active: false, path: 'README.md' })))

    h.listener?.('', 'README.md')
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(h.readFile).toHaveBeenCalledOnce()

    await act(async () => {
      root.render(createElement(Probe, { path: 'README.md' }))
      await Promise.resolve()
    })
    expect(h.readFile).toHaveBeenCalledTimes(2)
    expect(container.firstElementChild?.getAttribute('data-content')).toBe('second')
  })
})
