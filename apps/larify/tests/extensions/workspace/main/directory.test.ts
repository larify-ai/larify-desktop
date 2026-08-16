import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compareFileNodes,
  readDirectory,
  toFileNode
} from '../../../../src/extensions/workspace/main/directory'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'larify-directory-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace directory', () => {
  it('converts directory entries to tree nodes', () => {
    expect(
      toFileNode('C:\\work', {
        isFile: () => true,
        name: 'file.txt'
      })
    ).toEqual({ isLeaf: true, key: path.join('C:\\work', 'file.txt'), title: 'file.txt' })
  })

  it('sorts directories first and names naturally', () => {
    const entries = [
      { isLeaf: true, key: '10', title: '10.txt' },
      { isLeaf: false, key: 'src', title: 'src' },
      { isLeaf: true, key: '2', title: '2.txt' }
    ]

    expect(entries.sort(compareFileNodes).map(({ title }) => title)).toEqual([
      'src',
      '2.txt',
      '10.txt'
    ])
  })

  it('returns rc-tree-shaped entries with directories first', async () => {
    const root = await createRoot()
    await writeFile(path.join(root, '10.txt'), '')
    await writeFile(path.join(root, '2.txt'), '')
    await mkdir(path.join(root, 'src'))
    await mkdir(path.join(root, '.git'))

    await expect(readDirectory(root)).resolves.toEqual([
      { isLeaf: false, key: path.join(root, 'src'), title: 'src' },
      { isLeaf: true, key: path.join(root, '2.txt'), title: '2.txt' },
      { isLeaf: true, key: path.join(root, '10.txt'), title: '10.txt' }
    ])
  })

  it('reads any selected local directory', async () => {
    const directory = await createRoot()
    await writeFile(path.join(directory, 'file.txt'), '')

    await expect(readDirectory(directory)).resolves.toEqual([
      { isLeaf: true, key: path.join(directory, 'file.txt'), title: 'file.txt' }
    ])
  })
})
