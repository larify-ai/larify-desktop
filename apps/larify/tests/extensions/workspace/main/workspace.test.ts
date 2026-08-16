import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveWorkspace } from '../../../../src/extensions/workspace/main/workspace'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'larify-workspace-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace operations', () => {
  it('resolves a workspace directory', async () => {
    const root = await createRoot()
    await expect(resolveWorkspace(root)).resolves.toBe(root)
  })

  it('rejects a file as a workspace root', async () => {
    const root = await createRoot()
    const file = path.join(root, 'file.txt')
    await writeFile(file, '')
    await expect(resolveWorkspace(file)).rejects.toThrow('not a directory')
  })

  it('resolves relative and normalized directory paths to an absolute real path', async () => {
    const root = await createRoot()
    const nested = path.join(root, '目录')
    await mkdir(nested)
    const relative = path.relative(process.cwd(), path.join(nested, '..', '目录'))

    await expect(resolveWorkspace(relative)).resolves.toBe(nested)
  })

  it('rejects a missing workspace path', async () => {
    const root = await createRoot()

    await expect(resolveWorkspace(path.join(root, 'missing'))).rejects.toThrow()
  })
})
