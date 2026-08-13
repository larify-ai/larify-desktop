import type { Dirent } from 'node:fs'
import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { FileNode } from '../shared/types'

export function toFileNode(directory: string, entry: Pick<Dirent, 'isFile' | 'name'>): FileNode {
  return {
    isLeaf: entry.isFile(),
    key: path.join(directory, entry.name),
    title: entry.name
  }
}

export function compareFileNodes(a: FileNode, b: FileNode): number {
  if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
}

export async function readDirectory(directory: string): Promise<FileNode[]> {
  const target = await realpath(path.resolve(directory))

  return (await readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.name !== '.git' && (entry.isDirectory() || entry.isFile()))
    .map((entry) => toFileNode(target, entry))
    .sort(compareFileNodes)
}
