import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  open: vi.fn(async (root: string) => void root),
  instances: [] as Array<{
    dispose: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    onChange?: (event: string, path: string) => void
    rootPath: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('../../../../src/extensions/workspace/main/workspace', () => ({
  resolveWorkspace: vi.fn(async (root: string) => root)
}))

vi.mock('../../../../src/extensions/workspace/main/service', () => ({
  WorkspaceService: class {
    dispose = vi.fn(async () => {
      await this.opening.catch(() => undefined)
    })
    private opening: Promise<void>
    list = vi.fn(async () => {
      await this.opening
      return []
    })
    rootPath = vi.fn(async () => {
      await this.opening
      return this.currentRoot
    })
    private currentRoot: string

    constructor(root: string, onChange: (event: string, path: string) => void) {
      this.currentRoot = root
      this.opening = workspace.open(root)
      workspace.instances.push(this)
      this.onChange = onChange
    }
  }
}))

import { WorkspaceManager } from '../../../../src/extensions/workspace/main/manager'

describe('WorkspaceManager', () => {
  beforeEach(() => {
    workspace.instances.length = 0
    vi.clearAllMocks()
    workspace.open.mockResolvedValue(undefined)
  })

  it('keeps different roots isolated', async () => {
    const manager = new WorkspaceManager()
    manager.open(1, 'D:\\first')
    manager.open(2, 'D:\\second')

    await manager.list(1)
    await manager.list(2)

    expect(workspace.instances).toHaveLength(2)
    expect(workspace.open).toHaveBeenCalledWith('D:\\first')
    expect(workspace.open).toHaveBeenCalledWith('D:\\second')
  })

  it('keeps resources for the same root isolated', async () => {
    const manager = new WorkspaceManager()
    const first = manager.open(1, 'D:\\shared')
    const second = manager.open(2, 'D:\\shared')

    await Promise.all([manager.list(1), manager.list(2)])
    expect(workspace.instances).toHaveLength(2)

    await first.dispose()
    expect(workspace.instances[0].dispose).toHaveBeenCalledOnce()
    expect(workspace.instances[1].dispose).not.toHaveBeenCalled()

    await second.dispose()
    expect(workspace.instances[1].dispose).toHaveBeenCalledOnce()
  })

  it('sends changes only to the owning resource', async () => {
    const manager = new WorkspaceManager()
    const listener = vi.fn()
    manager.bindChange(listener)
    manager.open(1, 'D:\\shared')
    manager.open(2, 'D:\\shared')
    await Promise.all([manager.list(1), manager.list(2)])

    workspace.instances[0].onChange?.('add', 'D:\\shared\\file.ts')

    expect(listener).toHaveBeenCalledWith(1, 'add', 'D:\\shared\\file.ts')
    expect(listener).not.toHaveBeenCalledWith(2, 'add', 'D:\\shared\\file.ts')
  })

  it('ignores late changes after a resource closes', async () => {
    const manager = new WorkspaceManager()
    const listener = vi.fn()
    manager.bindChange(listener)
    const resource = manager.open(1, 'D:\\workspace')
    await manager.list(1)

    await resource.dispose()
    workspace.instances[0].onChange?.('change', 'D:\\workspace\\file.ts')

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps a failed service until its resource closes', async () => {
    workspace.open.mockRejectedValueOnce(new Error('failed'))
    const manager = new WorkspaceManager()
    const resource = manager.open(1, 'D:\\broken')

    await expect(manager.list(1)).rejects.toThrow('failed')
    await expect(manager.list(1)).rejects.toThrow('failed')
    expect(workspace.instances[0].dispose).not.toHaveBeenCalled()

    await resource.dispose()
    expect(workspace.instances[0].dispose).toHaveBeenCalledOnce()
    await expect(manager.list(1)).rejects.toThrow('Workspace resource 1 is not open')
  })

  it('does not dispose twice when closed during failed initialization', async () => {
    let rejectOpen: (error: Error) => void = () => undefined
    workspace.open.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOpen = reject
        })
    )
    const manager = new WorkspaceManager()
    const workspaceResource = manager.open(1, 'D:\\broken')

    const closing = workspaceResource.dispose()
    rejectOpen(new Error('failed'))
    await closing
    await Promise.resolve()

    expect(workspace.instances[0].dispose).toHaveBeenCalledOnce()
  })

  it('rejects duplicate resource ids', () => {
    const manager = new WorkspaceManager()
    manager.open(1, 'D:\\first')

    expect(() => manager.open(1, 'D:\\second')).toThrow('Workspace resource 1 is already open')
  })

  it('disposes every open workspace', async () => {
    const manager = new WorkspaceManager()
    manager.open(1, 'D:\\first')
    manager.open(2, 'D:\\second')

    await manager.dispose()

    expect(workspace.instances[0].dispose).toHaveBeenCalledOnce()
    expect(workspace.instances[1].dispose).toHaveBeenCalledOnce()
  })
})
