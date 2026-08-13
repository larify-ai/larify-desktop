import type { Dirent } from 'node:fs'
import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { FileInfo } from '../shared/types'

export function toFileInfo(directory: string, entry: Pick<Dirent, 'isFile' | 'name'>): FileInfo {
  return {
    isLeaf: entry.isFile(),
    key: path.join(directory, entry.name),
    title: entry.name
  }
}

export function compareFileInfo(a: FileInfo, b: FileInfo): number {
  if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
}

export async function readDirectory(directory: string): Promise<FileInfo[]> {
  const target = await realpath(path.resolve(directory))

  return (await readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.name !== '.git' && (entry.isDirectory() || entry.isFile()))
    .map((entry) => toFileInfo(target, entry))
    .sort(compareFileInfo)
}
