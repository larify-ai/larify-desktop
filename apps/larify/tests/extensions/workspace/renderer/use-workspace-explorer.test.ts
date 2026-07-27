// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  cwd: 'D:\\workspace',
  listener: undefined as ((event: string, path: string) => void) | undefined,
  open: vi.fn(async (cwd: string) => cwd),
  readDirectory: vi.fn()
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@renderer/lib/agent-session', () => ({
  useAgentSessionCwd: () => workspace.cwd
}))

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: {
    onDidChange: (listener: (event: string, path: string) => void) => {
      workspace.listener = listener
      return () => {
        if (workspace.listener === listener) workspace.listener = undefined
      }
    },
    open: workspace.open,
    readDirectory: workspace.readDirectory
  }
}))

vi.mock('../../../../src/extensions/workspace/renderer/monaco', () => ({
  setWorkspaceRoot: vi.fn()
}))

import { useWorkspaceExplorer } from '../../../../src/extensions/workspace/renderer/use-workspace-explorer'

describe('useWorkspaceExplorer', () => {
  let container: HTMLDivElement
  let root: Root
  let explorer: ReturnType<typeof useWorkspaceExplorer>

  function Harness(): null {
    explorer = useWorkspaceExplorer()
    return null
  }

  beforeEach(async () => {
    workspace.cwd = 'D:\\workspace'
    workspace.readDirectory.mockImplementation(async (directory?: string) =>
      directory
        ? [{ kind: 'file', name: 'file.ts', path: `${directory}\\file.ts` }]
        : [{ kind: 'directory', name: 'src', path: 'D:\\workspace\\src' }]
    )
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.clearAllMocks()
  })

  it('does not reload directories that were already revealed', async () => {
    await act(async () => explorer.revealFile('D:\\workspace\\src\\file.ts'))
    await act(async () => explorer.revealFile('D:\\workspace\\src\\file.ts'))

    expect(workspace.readDirectory).toHaveBeenCalledTimes(2)
    expect(workspace.readDirectory).toHaveBeenNthCalledWith(1)
    expect(workspace.readDirectory).toHaveBeenNthCalledWith(2, 'D:\\workspace\\src')
  })

  it('reloads a directory after it is removed and recreated', async () => {
    await act(async () => explorer.revealFile('D:\\workspace\\src\\file.ts'))
    await act(async () => {
      workspace.listener?.('unlinkDir', 'D:\\workspace\\src')
      await Promise.resolve()
    })
    await act(async () => explorer.revealFile('D:\\workspace\\src\\file.ts'))

    expect(
      workspace.readDirectory.mock.calls.filter(([directory]) => directory === 'D:\\workspace\\src')
    ).toHaveLength(2)
  })

  it('keeps case-sensitive POSIX directories distinct', async () => {
    workspace.cwd = '/workspace'
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (!directory) {
        return [
          { kind: 'directory', name: 'Foo', path: '/workspace/Foo' },
          { kind: 'directory', name: 'foo', path: '/workspace/foo' }
        ]
      }
      return [{ kind: 'file', name: 'file.ts', path: `${directory}/file.ts` }]
    })

    await act(async () => root.render(createElement(Harness)))
    await act(async () => explorer.revealFile('/workspace/Foo/file.ts'))
    await act(async () => explorer.revealFile('/workspace/foo/file.ts'))

    expect(workspace.readDirectory).toHaveBeenCalledWith('/workspace/Foo')
    expect(workspace.readDirectory).toHaveBeenCalledWith('/workspace/foo')
  })

  it('ignores a stale reveal that finishes after a newer one', async () => {
    let resolveOld:
      ((value: Array<{ kind: 'file'; name: string; path: string }>) => void) | undefined
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (!directory) {
        return [
          { kind: 'directory', name: 'old', path: 'D:\\workspace\\old' },
          { kind: 'directory', name: 'new', path: 'D:\\workspace\\new' }
        ]
      }
      if (directory.endsWith('\\old')) {
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      }
      return [{ kind: 'file', name: 'new.ts', path: `${directory}\\new.ts` }]
    })

    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))

    const oldReveal = explorer.revealFile('D:\\workspace\\old\\old.ts')
    await act(async () => explorer.revealFile('D:\\workspace\\new\\new.ts'))
    await act(async () => {
      resolveOld?.([{ kind: 'file', name: 'old.ts', path: 'D:\\workspace\\old\\old.ts' }])
      await oldReveal
    })

    expect(explorer.entries.find((entry) => entry.name === 'new')?.children).toHaveLength(1)
    expect(explorer.entries.find((entry) => entry.name === 'old')?.children).toEqual([])
  })

  it('ignores a directory read that finishes after switching roots', async () => {
    let resolveOld:
      ((value: Array<{ kind: 'file'; name: string; path: string }>) => void) | undefined
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (directory === 'D:\\workspace\\src') {
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      }
      if (workspace.cwd === 'D:\\other') {
        return [{ kind: 'file', name: 'other.ts', path: 'D:\\other\\other.ts' }]
      }
      return [{ kind: 'directory', name: 'src', path: 'D:\\workspace\\src' }]
    })

    const staleLoad = explorer.loadDirectory(explorer.entries[0])
    workspace.cwd = 'D:\\other'
    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      resolveOld?.([{ kind: 'file', name: 'old.ts', path: 'D:\\workspace\\src\\old.ts' }])
      await staleLoad
    })

    expect(explorer.root).toBe('D:\\other')
    expect(explorer.entries).toEqual([
      { kind: 'file', name: 'other.ts', path: 'D:\\other\\other.ts', loaded: true }
    ])
  })
})
