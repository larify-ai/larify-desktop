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
import { invalidateGitStatus } from '../../../../src/extensions/workspace/renderer/changes/git-status-invalidation'
import {
  GitStatusCoordinator,
  gitStatusCoordinator
} from '../../../../src/extensions/workspace/renderer/changes/git-status-coordinator'

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
    active,
    includeIgnored,
    preloadInactive,
    resourceId = 7,
    root = 'D:\\workspace'
  }: {
    active?: boolean
    includeIgnored?: boolean
    preloadInactive?: boolean
    resourceId?: number
    root?: string | null
  }): null {
    current = useGitDecorations(resourceId, root, { active, includeIgnored, preloadInactive })
    return null
  }

  beforeEach(() => {
    gitStatusCoordinator.clear()
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

  it('shares one status request across views and merges the ignored-file requirement', async () => {
    h.status.mockResolvedValue([])

    await act(async () => {
      reactRoot.render(
        createElement(
          'div',
          null,
          createElement(Probe, { includeIgnored: false, resourceId: 7, key: 'changes' }),
          createElement(Probe, { includeIgnored: true, resourceId: 8, key: 'workspace' })
        )
      )
      await Promise.resolve()
    })

    expect(h.status).toHaveBeenCalledOnce()
    expect(h.status).toHaveBeenCalledWith('D:\\workspace', true)
  })

  it('returns a snapshot for each equivalent spelling of a shared root', async () => {
    const changed = status('D:\\workspace\\file.ts')
    const fetchStatus = vi.fn(async () => [changed])
    const coordinator = new GitStatusCoordinator(fetchStatus)
    const deactivate = coordinator.activate('D:\\workspace', false)
    await Promise.resolve()
    await Promise.resolve()

    expect(coordinator.snapshot('d:/workspace/', false)).toMatchObject({
      loading: false,
      root: 'd:/workspace/',
      statuses: [changed]
    })
    expect(fetchStatus).toHaveBeenCalledOnce()
    deactivate()
    coordinator.clear()
  })

  it('cancels a pending refresh when a stronger request runs immediately', async () => {
    const fetchStatus = vi.fn(async () => [])
    const coordinator = new GitStatusCoordinator(fetchStatus)
    const deactivateChanges = coordinator.activate('D:\\workspace', false)
    await Promise.resolve()
    await Promise.resolve()
    coordinator.refresh('D:\\workspace')

    const deactivateExplorer = coordinator.activate('D:\\workspace', true)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(400)

    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(fetchStatus).toHaveBeenLastCalledWith('D:\\workspace', true)
    deactivateExplorer()
    deactivateChanges()
    coordinator.clear()
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

  it('refreshes after a matching Git status invalidation', async () => {
    h.status.mockResolvedValue([])
    await act(async () => {
      reactRoot.render(createElement(Probe, {}))
      await Promise.resolve()
    })

    invalidateGitStatus('d:/workspace/')
    await act(async () => vi.advanceTimersByTimeAsync(400))

    expect(h.status).toHaveBeenCalledTimes(2)
  })

  it('ignores Git status invalidations for another root', async () => {
    h.status.mockResolvedValue([])
    await act(async () => {
      reactRoot.render(createElement(Probe, {}))
      await Promise.resolve()
    })

    invalidateGitStatus('D:/other')
    await act(async () => vi.advanceTimersByTimeAsync(400))

    expect(h.status).toHaveBeenCalledOnce()
  })

  it('refreshes when the window regains focus', async () => {
    h.status.mockResolvedValue([])
    await act(async () => {
      reactRoot.render(createElement(Probe, {}))
      await Promise.resolve()
    })

    window.dispatchEvent(new Event('focus'))
    await act(async () => vi.advanceTimersByTimeAsync(400))

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

  it('does no Git work for an inactive view unless preloading is requested', async () => {
    await act(async () => reactRoot.render(createElement(Probe, { active: false })))

    expect(h.status).not.toHaveBeenCalled()
    expect(h.listener).toBeUndefined()
    expect(current.statuses).toEqual([])
  })

  it('preloads one inactive snapshot and keeps its lightweight watcher', async () => {
    const changed = status('D:\\workspace\\file.ts')
    h.status.mockResolvedValue([changed])
    await act(async () => {
      reactRoot.render(createElement(Probe, { active: false, preloadInactive: true }))
      await Promise.resolve()
    })

    expect(h.status).toHaveBeenCalledOnce()
    expect(h.listener).toBeTypeOf('function')
    expect(current.statuses).toEqual([changed])

    await act(async () =>
      reactRoot.render(createElement(Probe, { active: false, preloadInactive: true }))
    )
    expect(h.status).toHaveBeenCalledOnce()
  })

  it('reuses the cached snapshot immediately and refreshes after observation resumes', async () => {
    const changed = status('D:\\workspace\\file.ts')
    h.status.mockResolvedValue([changed])
    await act(async () => {
      reactRoot.render(createElement(Probe, { active: true }))
      await Promise.resolve()
    })

    await act(async () => reactRoot.render(createElement(Probe, { active: false })))
    expect(h.unsubscribe).toHaveBeenCalledOnce()
    expect(h.status).toHaveBeenCalledOnce()
    expect(current.statuses).toEqual([changed])

    await act(async () => {
      reactRoot.render(createElement(Probe, { active: true }))
      await Promise.resolve()
    })
    expect(current.statuses).toEqual([changed])
    expect(h.status).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(h.status).toHaveBeenCalledTimes(2)
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
