// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  cwd: 'D:\\workspace',
  resourceId: 7,
  listener: undefined as ((directory: string) => void) | undefined,
  open: vi.fn(async (cwd: string) => cwd),
  readDirectory: vi.fn(),
  reveal: vi.fn()
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient: {
    onDidChange: (_resourceId: number, listener: (directory: string) => void) => {
      workspace.listener = listener
      return () => {
        if (workspace.listener === listener) workspace.listener = undefined
      }
    },
    readDirectory: async (_resourceId: number, directory?: string) => ({
      entries: await workspace.readDirectory(directory),
      root: await workspace.open(workspace.cwd)
    }),
    reveal: (resourceId: number, file: string) => workspace.reveal(resourceId, file)
  }
}))

import { useWorkspaceExplorer } from '../../../../src/extensions/workspace/renderer/explorer/use-workspace-explorer'

describe('useWorkspaceExplorer', () => {
  let container: HTMLDivElement
  let root: Root
  let explorer: ReturnType<typeof useWorkspaceExplorer>

  function Harness(): null {
    explorer = useWorkspaceExplorer(workspace.resourceId)
    return null
  }

  beforeEach(async () => {
    workspace.cwd = 'D:\\workspace'
    workspace.resourceId = 7
    workspace.readDirectory.mockImplementation(async (directory?: string) =>
      directory
        ? [{ isLeaf: true, key: `${directory}\\file.ts`, title: 'file.ts' }]
        : [{ isLeaf: false, key: 'D:\\workspace\\src', title: 'src' }]
    )
    workspace.reveal.mockImplementation(async (_resourceId: number, file: string) => {
      const separator = file.includes('\\') ? '\\' : '/'
      const relative = file.slice(workspace.cwd.length).replace(/^[/\\]+/, '')
      const parts = relative.split(separator)
      return [
        ...parts
          .slice(0, -1)
          .map(
            (_part, index) =>
              `${workspace.cwd}${separator}${parts.slice(0, index + 1).join(separator)}`
          ),
        file
      ]
    })
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
    expect(workspace.readDirectory).toHaveBeenNthCalledWith(1, undefined)
    expect(workspace.readDirectory).toHaveBeenNthCalledWith(2, 'D:\\workspace\\src')
  })

  it('reveals a file requested before the workspace root finishes loading', async () => {
    let resolveInitial: ((entries: Array<{ key: string; title: string }>) => void) | undefined
    workspace.readDirectory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitial = resolve
        })
    )
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(createElement(Harness)))

    let revealed: string | undefined
    await act(async () => {
      revealed = await explorer.revealFile('D:\\workspace\\src\\file.ts')
    })

    expect(revealed).toBe('D:\\workspace\\src\\file.ts')
    expect(workspace.reveal).toHaveBeenCalledWith(7, 'D:\\workspace\\src\\file.ts')
    await act(async () => resolveInitial?.([{ key: 'D:\\workspace\\src', title: 'src' }]))
  })

  it('treats an empty load from a stale reveal callback as the workspace root', async () => {
    let resolveInitial: ((entries: Array<{ key: string; title: string }>) => void) | undefined
    workspace.readDirectory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitial = resolve
        })
    )
    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(createElement(Harness)))
    const staleReveal = explorer.revealFile

    await act(async () => resolveInitial?.([{ key: 'D:\\workspace\\src', title: 'src' }]))
    await act(async () => staleReveal('D:\\workspace\\src\\file.ts'))

    expect(workspace.readDirectory).not.toHaveBeenCalledWith('')
    expect(workspace.readDirectory).toHaveBeenCalledWith(undefined)
  })

  it('loads nested reveal paths one directory at a time', async () => {
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (!directory) return [{ key: 'D:\\workspace\\src', title: 'src' }]
      if (directory === 'D:\\workspace\\src') {
        return [{ key: 'D:\\workspace\\src\\nested', title: 'nested' }]
      }
      return [
        {
          isLeaf: true,
          key: 'D:\\workspace\\src\\nested\\file.ts',
          title: 'file.ts'
        }
      ]
    })

    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
    let revealed: string | undefined
    await act(async () => {
      revealed = await explorer.revealFile('D:\\workspace\\src\\nested\\file.ts')
    })

    expect(revealed).toBe('D:\\workspace\\src\\nested\\file.ts')
    expect(workspace.readDirectory.mock.calls.slice(-3)).toEqual([
      [undefined],
      ['D:\\workspace\\src'],
      ['D:\\workspace\\src\\nested']
    ])
  })

  it('loads a single-child directory chain in one expansion', async () => {
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (!directory) return [{ key: 'D:\\workspace\\src', title: 'src' }]
      if (directory === 'D:\\workspace\\src') {
        return [{ key: 'D:\\workspace\\src\\nested', title: 'nested' }]
      }
      return [{ isLeaf: true, key: `${directory}\\file.ts`, title: 'file.ts' }]
    })

    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
    await act(async () => explorer.loadDirectory(explorer.entries[0]))

    expect(workspace.readDirectory.mock.calls.slice(-3)).toEqual([
      [undefined],
      ['D:\\workspace\\src'],
      ['D:\\workspace\\src\\nested']
    ])
    expect(explorer.entries[0].children?.[0].children).toHaveLength(1)
  })

  it('reveals a file in the workspace root without another directory read', async () => {
    const reads = workspace.readDirectory.mock.calls.length
    let revealed: string | undefined

    await act(async () => {
      revealed = await explorer.revealFile('D:\\workspace\\root.ts')
    })

    expect(revealed).toBe('D:\\workspace\\root.ts')
    expect(workspace.readDirectory).toHaveBeenCalledTimes(reads)
  })

  it('returns no key for an empty reveal path', async () => {
    workspace.reveal.mockResolvedValueOnce([])

    await expect(explorer.revealFile('D:\\workspace')).resolves.toBeUndefined()
  })

  it('can reveal again after the reveal IPC fails', async () => {
    workspace.reveal.mockRejectedValueOnce(new Error('reveal failed'))

    await expect(explorer.revealFile('D:\\workspace\\src\\file.ts')).rejects.toThrow(
      'reveal failed'
    )
    await act(async () => {
      await expect(explorer.revealFile('D:\\workspace\\src\\file.ts')).resolves.toBe(
        'D:\\workspace\\src\\file.ts'
      )
    })
  })

  it('preserves loaded children when the parent refreshes', async () => {
    await act(async () => explorer.revealFile('D:\\workspace\\src\\file.ts'))
    workspace.readDirectory.mockResolvedValueOnce([
      { isLeaf: false, key: 'D:\\workspace\\src', title: 'src' },
      { isLeaf: true, key: 'D:\\workspace\\new.ts', title: 'new.ts' }
    ])
    await act(async () => {
      workspace.listener?.('D:\\workspace')
      await Promise.resolve()
    })

    expect(explorer.entries[0].children).toEqual([
      { isLeaf: true, key: 'D:\\workspace\\src\\file.ts', title: 'file.ts' }
    ])
  })

  it('loads the default space represented by an empty cwd', async () => {
    workspace.cwd = ''
    workspace.resourceId++
    workspace.open.mockResolvedValueOnce('D:\\default-workspace')
    workspace.readDirectory.mockResolvedValueOnce([
      { isLeaf: true, key: 'D:\\default-workspace\\default.txt', title: 'default.txt' }
    ])

    await act(async () => root.render(createElement(Harness)))

    expect(workspace.open).toHaveBeenLastCalledWith('')
    expect(explorer.root).toBe('D:\\default-workspace')
    expect(explorer.entries).toEqual([
      {
        isLeaf: true,
        key: 'D:\\default-workspace\\default.txt',
        title: 'default.txt'
      }
    ])
  })

  it('reloads a directory after it is removed and recreated', async () => {
    await act(async () => explorer.revealFile('D:\\workspace\\src\\file.ts'))
    workspace.readDirectory.mockResolvedValueOnce([])
    await act(async () => {
      workspace.listener?.('D:\\workspace')
      await Promise.resolve()
    })
    workspace.readDirectory.mockResolvedValueOnce([
      { isLeaf: false, key: 'D:\\workspace\\src', title: 'src' }
    ])
    await act(async () => {
      workspace.listener?.('D:\\workspace')
      await Promise.resolve()
    })
    await act(async () => explorer.revealFile('D:\\workspace\\src\\file.ts'))

    expect(
      workspace.readDirectory.mock.calls.filter(([directory]) => directory === 'D:\\workspace\\src')
    ).toHaveLength(2)
  })

  it('ignores an older directory refresh that finishes last', async () => {
    let resolveOld:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.readDirectory
      .mockImplementationOnce(async () => [
        { isLeaf: true, key: 'D:\\workspace\\initial.ts', title: 'initial.ts' }
      ])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValueOnce([{ isLeaf: true, key: 'D:\\workspace\\new.ts', title: 'new.ts' }])

    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      workspace.listener?.('D:\\workspace')
      workspace.listener?.('D:\\workspace')
      await Promise.resolve()
    })
    await act(async () => {
      resolveOld?.([{ isLeaf: true, key: 'D:\\workspace\\old.ts', title: 'old.ts' }])
      await Promise.resolve()
    })

    expect(explorer.entries).toEqual([
      { isLeaf: true, key: 'D:\\workspace\\new.ts', title: 'new.ts' }
    ])
  })

  it('refreshes after a change received during the initial load', async () => {
    let resolveInitial:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.readDirectory
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitial = resolve
          })
      )
      .mockResolvedValueOnce([{ isLeaf: true, key: 'D:\\workspace\\new.ts', title: 'new.ts' }])

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(createElement(Harness)))
    act(() => workspace.listener?.('D:\\workspace'))
    await act(async () => {
      resolveInitial?.([{ isLeaf: true, key: 'D:\\workspace\\old.ts', title: 'old.ts' }])
      await Promise.resolve()
    })

    expect(explorer.entries).toEqual([
      { isLeaf: true, key: 'D:\\workspace\\new.ts', title: 'new.ts' }
    ])
  })

  it('does not start a queued refresh after switching resources', async () => {
    const previousReads = workspace.readDirectory.mock.calls.length
    let resolveInitial:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.readDirectory
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitial = resolve
          })
      )
      .mockResolvedValueOnce([{ isLeaf: true, key: 'D:\\other\\new.ts', title: 'new.ts' }])

    act(() => root.unmount())
    root = createRoot(container)
    act(() => root.render(createElement(Harness)))
    act(() => workspace.listener?.('D:\\workspace'))

    workspace.cwd = 'D:\\other'
    workspace.resourceId++
    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      resolveInitial?.([{ isLeaf: true, key: 'D:\\workspace\\old.ts', title: 'old.ts' }])
      await Promise.resolve()
    })

    expect(workspace.readDirectory).toHaveBeenCalledTimes(previousReads + 2)
    expect(explorer.root).toBe('D:\\other')
    expect(explorer.entries).toEqual([{ isLeaf: true, key: 'D:\\other\\new.ts', title: 'new.ts' }])
  })

  it('keeps case-sensitive POSIX directories distinct', async () => {
    workspace.cwd = '/workspace'
    workspace.resourceId++
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (!directory) {
        return [
          { isLeaf: false, key: '/workspace/Foo', title: 'Foo' },
          { isLeaf: false, key: '/workspace/foo', title: 'foo' }
        ]
      }
      return [{ isLeaf: true, key: `${directory}/file.ts`, title: 'file.ts' }]
    })

    await act(async () => root.render(createElement(Harness)))
    await act(async () => explorer.revealFile('/workspace/Foo/file.ts'))
    await act(async () => explorer.revealFile('/workspace/foo/file.ts'))

    expect(workspace.readDirectory).toHaveBeenCalledWith('/workspace/Foo')
    expect(workspace.readDirectory).toHaveBeenCalledWith('/workspace/foo')
  })

  it('merges parallel loads for different directories', async () => {
    let resolveFirst:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    let resolveSecond:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (!directory) {
        return [
          { key: 'D:\\workspace\\first', title: 'first' },
          { key: 'D:\\workspace\\second', title: 'second' }
        ]
      }
      return new Promise((resolve) => {
        if (directory.endsWith('first')) resolveFirst = resolve
        else resolveSecond = resolve
      })
    })

    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))
    const first = explorer.loadDirectory(explorer.entries[0])
    const second = explorer.loadDirectory(explorer.entries[1])
    await act(async () => {
      resolveSecond?.([{ isLeaf: true, key: 'D:\\workspace\\second\\b.ts', title: 'b.ts' }])
      await second
    })
    await act(async () => {
      resolveFirst?.([{ isLeaf: true, key: 'D:\\workspace\\first\\a.ts', title: 'a.ts' }])
      await first
    })

    expect(explorer.entries[0].children).toHaveLength(1)
    expect(explorer.entries[1].children).toHaveLength(1)
  })

  it('ignores a stale reveal that finishes after a newer one', async () => {
    let resolveOld:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (!directory) {
        return [
          { isLeaf: false, key: 'D:\\workspace\\old', title: 'old' },
          { isLeaf: false, key: 'D:\\workspace\\new', title: 'new' }
        ]
      }
      if (directory.endsWith('\\old')) {
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      }
      return [{ isLeaf: true, key: `${directory}\\new.ts`, title: 'new.ts' }]
    })

    act(() => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(createElement(Harness)))

    const oldReveal = explorer.revealFile('D:\\workspace\\old\\old.ts')
    await act(async () => explorer.revealFile('D:\\workspace\\new\\new.ts'))
    await act(async () => {
      resolveOld?.([{ isLeaf: true, key: 'D:\\workspace\\old\\old.ts', title: 'old.ts' }])
      await oldReveal
    })

    expect(explorer.entries.find((entry) => entry.title === 'new')?.children).toHaveLength(1)
    expect(explorer.entries.find((entry) => entry.title === 'old')?.children).toBeUndefined()
  })

  it('does not load directories for a reveal cancelled before path resolution', async () => {
    let resolveOld: ((value: string[]) => void) | undefined
    workspace.reveal
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValueOnce(['D:\\workspace\\src', 'D:\\workspace\\src\\new.ts'])

    const oldReveal = explorer.revealFile('D:\\workspace\\src\\old.ts')
    await act(async () => explorer.revealFile('D:\\workspace\\src\\new.ts'))
    const readsAfterNewReveal = workspace.readDirectory.mock.calls.length
    await act(async () => {
      resolveOld?.(['D:\\workspace\\old', 'D:\\workspace\\old\\old.ts'])
      await oldReveal
    })

    expect(workspace.readDirectory).toHaveBeenCalledTimes(readsAfterNewReveal)
    expect(workspace.readDirectory).not.toHaveBeenCalledWith('D:\\workspace\\old')
  })

  it('cancels a pending reveal when switching resources', async () => {
    let resolveReveal: ((value: string[]) => void) | undefined
    workspace.reveal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReveal = resolve
        })
    )

    const reveal = explorer.revealFile('D:\\workspace\\old\\file.ts')
    workspace.cwd = 'D:\\other'
    workspace.resourceId++
    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      resolveReveal?.(['D:\\workspace\\old', 'D:\\workspace\\old\\file.ts'])
    })

    await expect(reveal).resolves.toBeUndefined()
    expect(workspace.readDirectory).not.toHaveBeenCalledWith('D:\\workspace\\old')
  })

  it('cancels a pending reveal when unmounted', async () => {
    let resolveReveal: ((value: string[]) => void) | undefined
    workspace.reveal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReveal = resolve
        })
    )

    const reveal = explorer.revealFile('D:\\workspace\\old\\file.ts')
    act(() => root.unmount())
    await act(async () => {
      resolveReveal?.(['D:\\workspace\\old', 'D:\\workspace\\old\\file.ts'])
    })

    await expect(reveal).resolves.toBeUndefined()
    expect(workspace.readDirectory).not.toHaveBeenCalledWith('D:\\workspace\\old')
  })

  it('does not reveal through a directory load superseded by a failed refresh', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let resolveReveal:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.readDirectory
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReveal = resolve
          })
      )
      .mockRejectedValueOnce(new Error('refresh failed'))

    const revealed = explorer.revealFile('D:\\workspace\\src\\file.ts')
    await act(async () => {
      workspace.listener?.('D:\\workspace\\src')
      await Promise.resolve()
    })
    let result: string | undefined
    await act(async () => {
      resolveReveal?.([{ isLeaf: true, key: 'D:\\workspace\\src\\file.ts', title: 'file.ts' }])
      result = await revealed
    })

    expect(result).toBeUndefined()
    expect(explorer.entries[0].children).toBeUndefined()
    consoleError.mockRestore()
  })

  it('ignores a directory read that finishes after switching roots', async () => {
    let resolveOld:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.readDirectory.mockImplementation(async (directory?: string) => {
      if (directory === 'D:\\workspace\\src') {
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      }
      if (workspace.cwd === 'D:\\other') {
        return [{ isLeaf: true, key: 'D:\\other\\other.ts', title: 'other.ts' }]
      }
      return [{ isLeaf: false, key: 'D:\\workspace\\src', title: 'src' }]
    })

    const staleLoad = explorer.loadDirectory(explorer.entries[0])
    workspace.cwd = 'D:\\other'
    workspace.resourceId++
    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      resolveOld?.([{ isLeaf: true, key: 'D:\\workspace\\src\\old.ts', title: 'old.ts' }])
      await staleLoad
    })

    expect(explorer.root).toBe('D:\\other')
    expect(explorer.entries).toEqual([
      { isLeaf: true, key: 'D:\\other\\other.ts', title: 'other.ts' }
    ])
  })

  it('handles failed initial loads and refreshes', async () => {
    const error = new Error('unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    workspace.resourceId++
    workspace.readDirectory.mockRejectedValueOnce(error).mockRejectedValueOnce(error)

    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      workspace.listener?.('D:\\workspace')
      await Promise.resolve()
    })

    expect(consoleError).toHaveBeenCalledWith('[workspace:list]', error)
    expect(consoleError).toHaveBeenCalledWith('[workspace:refresh]', error)
    consoleError.mockRestore()
  })

  it('recovers from a failed initial load when the workspace changes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    workspace.resourceId++
    workspace.readDirectory
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([
        { isLeaf: true, key: 'D:\\workspace\\recovered.ts', title: 'recovered.ts' }
      ])

    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      workspace.listener?.('D:\\workspace\\src')
      await Promise.resolve()
    })

    expect(workspace.readDirectory).toHaveBeenLastCalledWith(undefined)
    expect(explorer.root).toBe('D:\\workspace')
    expect(explorer.entries).toEqual([
      { isLeaf: true, key: 'D:\\workspace\\recovered.ts', title: 'recovered.ts' }
    ])
    consoleError.mockRestore()
  })

  it('ignores an older root recovery triggered by another directory', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let resolveOld:
      ((value: Array<{ isLeaf: true; key: string; title: string }>) => void) | undefined
    workspace.resourceId++
    workspace.readDirectory
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValueOnce([{ isLeaf: true, key: 'D:\\workspace\\new.ts', title: 'new.ts' }])

    await act(async () => root.render(createElement(Harness)))
    await act(async () => {
      workspace.listener?.('D:\\workspace\\first')
      workspace.listener?.('D:\\workspace\\second')
      await Promise.resolve()
    })
    await act(async () => {
      resolveOld?.([{ isLeaf: true, key: 'D:\\workspace\\old.ts', title: 'old.ts' }])
      await Promise.resolve()
    })

    expect(explorer.entries).toEqual([
      { isLeaf: true, key: 'D:\\workspace\\new.ts', title: 'new.ts' }
    ])
    consoleError.mockRestore()
  })
})
