// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileStatusResult } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  listener: undefined as (() => void) | undefined,
  status: vi.fn(),
  unsubscribe: vi.fn()
}))

vi.mock('../../../../src/extensions/workspace/renderer/git-client', () => ({
  gitClient: { status: h.status }
}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: {
    onDidChange: vi.fn((_resourceId: number, listener: () => void) => {
      h.listener = listener
      return h.unsubscribe
    })
  }
}))

import { useGitDecorations } from '../../../../src/extensions/workspace/renderer/changes/use-git-decorations'

const status = (path: string): FileStatusResult =>
  ({ index: ' ', path, working_dir: 'M' }) as FileStatusResult

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

describe('useGitDecorations', () => {
  let container: HTMLDivElement
  let reactRoot: Root
  let current: ReturnType<typeof useGitDecorations>

  function Probe({
    includeIgnored,
    resourceId = 7,
    root = 'D:\\workspace'
  }: {
    includeIgnored?: boolean
    resourceId?: number
    root?: string | null
  }): null {
    current = useGitDecorations(resourceId, root, { includeIgnored })
    return null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    h.listener = undefined
    container = document.createElement('div')
    document.body.append(container)
    reactRoot = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => reactRoot.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('loads statuses and forwards the ignored-file option', async () => {
    const changed = status('D:\\workspace\\file.ts')
    h.status.mockResolvedValue([changed])

    await act(async () => {
      reactRoot.render(createElement(Probe, { includeIgnored: false }))
      await Promise.resolve()
    })

    expect(h.status).toHaveBeenCalledWith('D:\\workspace', false)
    expect(current.statuses).toEqual([changed])
    expect(current.loading).toBe(false)
    expect(current.decorations.has('D:\\workspace\\file.ts')).toBe(true)
  })

  it('reports loading until the initial status resolves', async () => {
    const pending = deferred<FileStatusResult[]>()
    h.status.mockReturnValue(pending.promise)
    await act(async () => reactRoot.render(createElement(Probe, {})))
    expect(current.loading).toBe(true)

    await act(async () => pending.resolve([]))
    expect(current.loading).toBe(false)
  })

  it('debounces changes and never overlaps status requests', async () => {
    const first = deferred<FileStatusResult[]>()
    h.status.mockReturnValueOnce(first.promise).mockResolvedValueOnce([])
    await act(async () => reactRoot.render(createElement(Probe, {})))

    h.listener?.()
    h.listener?.()
    expect(h.status).toHaveBeenCalledOnce()
    expect(h.status).toHaveBeenCalledWith('D:\\workspace', true)

    await act(async () => first.resolve([]))
    await act(async () => vi.advanceTimersByTimeAsync(399))
    expect(h.status).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(h.status).toHaveBeenCalledTimes(2)
  })

  it('cancels queued work when unmounted', async () => {
    const pending = deferred<FileStatusResult[]>()
    h.status.mockReturnValueOnce(pending.promise)
    await act(async () => reactRoot.render(createElement(Probe, {})))
    h.listener?.()

    await act(async () => reactRoot.unmount())
    await act(async () => pending.resolve([]))
    await act(async () => vi.advanceTimersByTimeAsync(400))

    expect(h.status).toHaveBeenCalledOnce()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
    reactRoot = createRoot(container)
  })

  it('ignores a stale request after switching roots', async () => {
    const stale = deferred<FileStatusResult[]>()
    const fresh = status('D:\\next\\fresh.ts')
    h.status.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([fresh])
    await act(async () => reactRoot.render(createElement(Probe, {})))

    await act(async () => reactRoot.render(createElement(Probe, { root: 'D:\\next' })))
    expect(current.statuses).toEqual([fresh])

    await act(async () => stale.resolve([status('D:\\workspace\\stale.ts')]))
    expect(current.statuses).toEqual([fresh])
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })

  it('clears stale statuses when refreshing fails', async () => {
    const error = new Error('status failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    h.status.mockResolvedValueOnce([status('D:\\workspace\\file.ts')]).mockRejectedValueOnce(error)
    await act(async () => {
      reactRoot.render(createElement(Probe, {}))
      await Promise.resolve()
    })
    expect(current.statuses).toHaveLength(1)

    h.listener?.()
    await act(async () => vi.advanceTimersByTimeAsync(400))

    expect(current.statuses).toEqual([])
    expect(current.error).toBe('status failed')
    expect(consoleError).toHaveBeenCalledWith('[workspace:git-status]', error)
    consoleError.mockRestore()
  })

  it('does not request or expose statuses without a root', async () => {
    await act(async () => reactRoot.render(createElement(Probe, { root: null })))

    expect(h.status).not.toHaveBeenCalled()
    expect(current.statuses).toEqual([])
    expect(current.decorations.size).toBe(0)
    expect(current.loading).toBe(false)
  })
})
