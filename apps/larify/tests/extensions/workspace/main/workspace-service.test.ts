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
    service.dispose()
  })

  it('reads and saves file bytes', async () => {
    const root = await createRoot()
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'const value = 1')
    const service = new WorkspaceService()
    await service.open(root, () => undefined)

    expect(new TextDecoder().decode(await service.read(file))).toBe('const value = 1')
    await service.write(file, new TextEncoder().encode('const value = 2'))
    expect(await readFile(file, 'utf8')).toBe('const value = 2')
    service.dispose()
  })

  it('rejects paths outside the open workspace', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const file = path.join(outside, 'secret.txt')
    await writeFile(file, 'secret')
    const service = new WorkspaceService()
    await service.open(root, () => undefined)

    await expect(service.read(file)).rejects.toThrow('outside the workspace')
    service.dispose()
  })
})
