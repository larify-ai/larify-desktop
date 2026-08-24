import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  open: vi.fn(async (root: string) => void root),
  instances: [] as Array<{
    dispose: ReturnType<typeof vi.fn>
    inspectFile: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    onChange?: (directory: string, changedPath: string) => void
    readAsset: ReturnType<typeof vi.fn>
    readFile: ReturnType<typeof vi.fn>
    reveal: ReturnType<typeof vi.fn>
    rootPath: ReturnType<typeof vi.fn>
    setActive: ReturnType<typeof vi.fn>
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
    inspectFile = vi.fn(async (file: string) => ({ binary: false, mime: 'text/plain', path: file }))
    list = vi.fn(async () => {
      await this.opening
      return []
    })
    readAsset = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }))
    readFile = vi.fn(async (file: string) => `contents:${file}`)
    reveal = vi.fn(async (file: string) => [file])
    rootPath = vi.fn(async () => {
      await this.opening
      return this.currentRoot
    })
    setActive = vi.fn(async () => undefined)
    private currentRoot: string

    constructor(root: string, onChange: (directory: string, changedPath: string) => void) {
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

  it('activates watchers only for the current session', async () => {
    const manager = new WorkspaceManager()
    manager.open(1, 'first-session', 'D:\\first')
    manager.open(2, 'second-session', 'D:\\second')

    await manager.setActiveSession('first-session')

    expect(workspace.instances[0].setActive).toHaveBeenCalledWith(true)
    expect(workspace.instances[1].setActive).toHaveBeenCalledWith(false)

    await manager.setActiveSession('second-session')
    expect(workspace.instances[0].setActive).toHaveBeenLastCalledWith(false)
    expect(workspace.instances[1].setActive).toHaveBeenLastCalledWith(true)
  })

  it('does not refresh a stale session after a newer activation wins', async () => {
    const manager = new WorkspaceManager()
    const listener = vi.fn()
    manager.bindChange(listener)
    manager.open(1, 'first-session', 'D:\\first')
    manager.open(2, 'second-session', 'D:\\second')
    let releaseFirst: () => void = () => undefined
    workspace.instances[0].setActive.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFirst = resolve))
    )

    const firstActivation = manager.setActiveSession('first-session')
    await Promise.resolve()
    const secondActivation = manager.setActiveSession('second-session')
    releaseFirst()
    await Promise.all([firstActivation, secondActivation])

    expect(listener).not.toHaveBeenCalledWith(1, 'D:\\first', 'D:\\first')
    expect(listener).toHaveBeenCalledWith(2, 'D:\\second', 'D:\\second')
  })

  it('does not refresh a resource closed while its session is activating', async () => {
    const manager = new WorkspaceManager()
    const listener = vi.fn()
    manager.bindChange(listener)
    const resource = manager.open(1, 'first-session', 'D:\\first')
    let releaseActivation: () => void = () => undefined
    workspace.instances[0].setActive.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseActivation = resolve))
    )

    const activation = manager.setActiveSession('first-session')
    await Promise.resolve()
    await resource.dispose()
    releaseActivation()
    await activation

    expect(listener).not.toHaveBeenCalled()
  })

  it('makes repeated activation wait for the in-flight session transition', async () => {
    const manager = new WorkspaceManager()
    manager.open(1, 'first-session', 'D:\\first')
    let releaseActivation: () => void = () => undefined
    workspace.instances[0].setActive.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseActivation = resolve))
    )

    const first = manager.setActiveSession('first-session')
    await Promise.resolve()
    let repeatedResolved = false
    const repeated = manager.setActiveSession('first-session').then(() => {
      repeatedResolved = true
    })
    await Promise.resolve()
    expect(repeatedResolved).toBe(false)

    releaseActivation()
    await Promise.all([first, repeated])
    expect(repeatedResolved).toBe(true)
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

    workspace.instances[0].onChange?.('D:\\shared', 'D:\\shared\\file.ts')

    expect(listener).toHaveBeenCalledWith(1, 'D:\\shared', 'D:\\shared\\file.ts')
    expect(listener).not.toHaveBeenCalledWith(2, 'D:\\shared', 'D:\\shared\\file.ts')
  })

  it('stops sending changes after the listener is unbound', () => {
    const manager = new WorkspaceManager()
    const listener = vi.fn()
    const unbind = manager.bindChange(listener)
    manager.open(1, 'D:\\workspace')

    unbind()
    workspace.instances[0].onChange?.('D:\\workspace', 'D:\\workspace\\file.ts')

    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores late changes after a resource closes', async () => {
    const manager = new WorkspaceManager()
    const listener = vi.fn()
    manager.bindChange(listener)
    const resource = manager.open(1, 'D:\\workspace')
    await manager.list(1)

    await resource.dispose()
    workspace.instances[0].onChange?.('D:\\workspace', 'D:\\workspace\\file.ts')

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

  it('routes reveals to the owning resource', async () => {
    const manager = new WorkspaceManager()
    manager.open(1, 'D:\\workspace')

    await expect(manager.reveal(1, 'D:\\workspace\\file.ts')).resolves.toEqual([
      'D:\\workspace\\file.ts'
    ])
    expect(workspace.instances[0].reveal).toHaveBeenCalledWith('D:\\workspace\\file.ts')
  })

  it('routes file reads, assets, and inspections to the owning resource', async () => {
    const manager = new WorkspaceManager()
    manager.open(1, 'D:\\workspace')
    const file = 'D:\\workspace\\file.ts'

    await expect(manager.readFile(1, file)).resolves.toBe(`contents:${file}`)
    await expect(manager.readAsset(1, file)).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png'
    })
    await expect(manager.inspectFile(1, file)).resolves.toEqual({
      binary: false,
      mime: 'text/plain',
      path: file
    })
    expect(workspace.instances[0].readFile).toHaveBeenCalledWith(file)
    expect(workspace.instances[0].readAsset).toHaveBeenCalledWith(file)
    expect(workspace.instances[0].inspectFile).toHaveBeenCalledWith(file)
  })

  it('does not let a stale resource handle close a replacement with the same id', async () => {
    const manager = new WorkspaceManager()
    const listener = vi.fn()
    manager.bindChange(listener)
    const stale = manager.open(1, 'D:\\first')
    await stale.dispose()
    manager.open(1, 'D:\\second')

    await stale.dispose()
    workspace.instances[0].onChange?.('D:\\first', 'D:\\first\\file.ts')

    await expect(manager.list(1)).resolves.toEqual({ entries: [], root: 'D:\\second' })
    expect(workspace.instances[1].dispose).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
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
