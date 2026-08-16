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
  it('reads a text file for preview', async () => {
    const root = await createRoot()
    const file = path.join(root, 'file.ts')
    await writeFile(file, 'export const value = 1')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.readFile(file)).resolves.toBe('export const value = 1')
    await service.dispose()
  })

  it('identifies text files from their names', async () => {
    const root = await createRoot()
    const file = path.join(root, 'file.txt')
    await writeFile(file, 'export const value = 1')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.inspectFile(file)).resolves.toEqual({
      binary: false,
      mime: 'text/plain',
      path: file
    })
    await service.dispose()
  })

  it('returns a normalized path from file inspection', async () => {
    const root = await createRoot()
    const file = path.join(root, 'file.txt')
    const unnormalized = `${path.join(root, 'nested')}${path.sep}..${path.sep}file.txt`
    await writeFile(file, 'hello')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.inspectFile(unnormalized)).resolves.toMatchObject({ path: file })
    await service.dispose()
  })

  it('uses the generic MIME type for unknown text files', async () => {
    const root = await createRoot()
    const file = path.join(root, 'Makefile')
    await writeFile(file, 'all:\n\techo done')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.inspectFile(file)).resolves.toEqual({
      binary: false,
      mime: 'application/octet-stream',
      path: file
    })
    await service.dispose()
  })

  it('identifies binary files from their contents', async () => {
    const root = await createRoot()
    const file = path.join(root, 'image')
    await writeFile(
      file,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.inspectFile(file)).resolves.toMatchObject({
      binary: true,
      mime: 'image/png',
      path: file
    })
    await service.dispose()
  })

  it('rejects files larger than the preview limit', async () => {
    const root = await createRoot()
    const file = path.join(root, 'large.txt')
    await writeFile(file, Buffer.alloc(20 * 1024 * 1024 + 1))
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.readFile(file)).rejects.toThrow('最大 20 MiB')
    await service.dispose()
  })

  it('reports file read failures', async () => {
    const root = await createRoot()
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.readFile(path.join(root, 'missing.txt'))).rejects.toThrow()
    await service.dispose()
  })

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

  it('resolves a file and its parent directories for tree reveal', async () => {
    const root = await createRoot()
    const source = path.join(root, 'src')
    const nested = path.join(source, 'nested')
    const file = path.join(nested, 'file.ts')
    await mkdir(nested, { recursive: true })
    await writeFile(file, '')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.reveal(file)).resolves.toEqual([source, nested, file])
    await service.dispose()
  })

  it('rejects revealing a file outside the workspace', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const file = path.join(outside, 'outside.txt')
    await writeFile(file, '')
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.reveal(file)).rejects.toThrow('Path is outside the workspace')
    await service.dispose()
  })

  it('reveals a deleted file from its former path', async () => {
    const root = await createRoot()
    const source = path.join(root, 'src')
    const file = path.join(source, 'deleted.ts')
    await mkdir(source)
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.reveal(file)).resolves.toEqual([source, file])
    await service.dispose()
  })

  it('rejects relative file paths', async () => {
    const root = await createRoot()
    const service = new WorkspaceService(root, () => undefined)

    await expect(service.reveal(path.join('src', 'file.ts'))).rejects.toThrow(
      'File path must be absolute'
    )
    await service.dispose()
  })

  it('rejects listing when the workspace cannot be opened', async () => {
    const missing = path.join(await createRoot(), 'missing')
    const service = new WorkspaceService(missing, () => undefined)

    await expect(service.list()).rejects.toThrow()
    await service.dispose()
  })
})
