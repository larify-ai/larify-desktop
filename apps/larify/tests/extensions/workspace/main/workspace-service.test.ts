import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceService } from '../../../../src/extensions/workspace/main/service'

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
    const service = new WorkspaceService(root, () => undefined)

    expect(await service.list()).toEqual([
      { isLeaf: false, key: path.join(root, 'src'), title: 'src' },
      { isLeaf: true, key: path.join(root, 'readme.txt'), title: 'readme.txt' }
    ])
    await service.dispose()
  })

  it('lists a selected directory outside the workspace', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    await writeFile(path.join(outside, 'outside.txt'), '')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.list(outside)).resolves.toEqual([
      { isLeaf: true, key: path.join(outside, 'outside.txt'), title: 'outside.txt' }
    ])
    await service.dispose()
  })

  it('rejects listing when the workspace cannot be opened', async () => {
    const missing = path.join(await createRoot(), 'missing')
    const service = new WorkspaceService(missing, () => undefined)

    await expect(service.list()).rejects.toThrow()
    await service.dispose()
  })
})
