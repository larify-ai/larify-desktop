import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceService } from '../../../../src/extensions/workspace/main/workspace-service'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'larify-workspace-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('WorkspaceService', () => {
  it('lists directories before files and hides Git internals', async () => {
    const root = await createRoot()
    await mkdir(path.join(root, 'src'))
    await mkdir(path.join(root, '.git'))
    await writeFile(path.join(root, 'readme.txt'), 'hello')
    const service = new WorkspaceService()

    await service.open(root, () => undefined)

    expect(await service.list()).toEqual([
      { kind: 'directory', name: 'src', path: path.join(root, 'src') },
      { kind: 'file', name: 'readme.txt', path: path.join(root, 'readme.txt') }
    ])
    await service.dispose()
  })

  it('reads and saves file bytes', async () => {
    const root = await createRoot()
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'const value = 1')
    const service = new WorkspaceService()
    await service.open(root, () => undefined)

    const handle = await service.openFile(file)
    expect(new TextDecoder().decode(await service.readFile(handle, 0, 1024))).toBe(
      'const value = 1'
    )
    await service.closeFile(handle)
    await service.write(file, new TextEncoder().encode('const value = 2'))
    expect(await readFile(file, 'utf8')).toBe('const value = 2')
    await service.dispose()
  })

  it('reads files incrementally through bounded handles', async () => {
    const root = await createRoot()
    const file = path.join(root, 'large.txt')
    await writeFile(file, '0123456789')
    const service = new WorkspaceService()
    await service.open(root, () => undefined)

    const handle = await service.openFile(file)
    expect(new TextDecoder().decode(await service.readFile(handle, 3, 4))).toBe('3456')
    await service.closeFile(handle)
    await expect(service.readFile(handle, 0, 1)).rejects.toThrow('closed')
    await service.dispose()
  })

  it('distinguishes unavailable Git from a clean repository', async () => {
    const root = await createRoot()
    const git = { status: async () => Promise.reject(new Error('Git failed')) }
    const service = new WorkspaceService(git as never)
    await service.open(root, () => undefined)

    await expect(service.getGitStatuses()).resolves.toEqual({
      available: false,
      message: 'Git failed'
    })
    await service.dispose()
  })

  it('shares concurrent Git status requests', async () => {
    const root = await createRoot()
    let calls = 0
    const git = {
      status: async () => {
        calls += 1
        return []
      }
    }
    const service = new WorkspaceService(git as never)
    await service.open(root, () => undefined)

    await Promise.all([service.getGitStatuses(), service.getGitStatuses()])

    expect(calls).toBe(1)
    await service.dispose()
  })

  it('rejects paths outside the open workspace', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const file = path.join(outside, 'secret.txt')
    await writeFile(file, 'secret')
    const service = new WorkspaceService()
    await service.open(root, () => undefined)

    await expect(service.openFile(file)).rejects.toThrow('outside the workspace')
    await service.dispose()
  })

  it('opens an explicitly allowed file without changing the workspace root', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const file = path.join(outside, 'external.txt')
    await writeFile(file, 'external')
    const service = new WorkspaceService()
    await service.open(root, () => undefined)

    await expect(service.allowFile(file)).resolves.toBe(file)
    const handle = await service.openFile(file)
    expect(new TextDecoder().decode(await service.readFile(handle, 0, 1024))).toBe('external')

    await service.dispose()
  })

  it('keeps open file handles when the same workspace is opened again', async () => {
    const root = await createRoot()
    const file = path.join(root, 'file.txt')
    await writeFile(file, 'content')
    const service = new WorkspaceService()
    await service.open(root, () => undefined)
    const handle = await service.openFile(file)

    await service.open(root, () => undefined)

    expect(new TextDecoder().decode(await service.readFile(handle, 0, 1024))).toBe('content')
    await service.dispose()
  })

  it('serializes concurrent workspace changes', async () => {
    const first = await createRoot()
    const second = await createRoot()
    await writeFile(path.join(first, 'first.txt'), 'first')
    await writeFile(path.join(second, 'second.txt'), 'second')
    const service = new WorkspaceService()

    await Promise.all([service.open(first, () => undefined), service.open(second, () => undefined)])

    expect(await service.list()).toEqual([
      { kind: 'file', name: 'second.txt', path: path.join(second, 'second.txt') }
    ])
    await service.dispose()
  })

  it('continues opening workspaces after an earlier request fails', async () => {
    const missing = path.join(await createRoot(), 'missing')
    const valid = await createRoot()
    await writeFile(path.join(valid, 'valid.txt'), 'valid')
    const service = new WorkspaceService()

    await expect(service.open(missing, () => undefined)).rejects.toThrow()
    await expect(service.open(valid, () => undefined)).resolves.toBe(valid)
    expect(await service.list()).toEqual([
      { kind: 'file', name: 'valid.txt', path: path.join(valid, 'valid.txt') }
    ])
    await service.dispose()
  })

  it('revokes external file access when switching workspaces', async () => {
    const first = await createRoot()
    const second = await createRoot()
    const external = path.join(await createRoot(), 'external.txt')
    await writeFile(external, 'external')
    const service = new WorkspaceService()

    await service.open(first, () => undefined)
    await service.allowFile(external)
    await expect(service.openFile(external)).resolves.toBeTypeOf('number')

    await service.open(second, () => undefined)
    await expect(service.openFile(external)).rejects.toThrow('outside the workspace')
    await service.dispose()
  })

  it('closes file handles when switching workspaces', async () => {
    const first = await createRoot()
    const second = await createRoot()
    const file = path.join(first, 'file.txt')
    await writeFile(file, 'content')
    const service = new WorkspaceService()

    await service.open(first, () => undefined)
    const handle = await service.openFile(file)
    await service.open(second, () => undefined)

    await expect(service.readFile(handle, 0, 1)).rejects.toThrow('closed')
    await service.dispose()
  })
})
