import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureLarifyPath } from '../../../main/utils/app-paths'

const indexes = (): string => ensureLarifyPath('indexes')

export function workspaceIndexPath(cwd: string, root = indexes()): string {
  const id = createHash('sha256').update(resolve(cwd)).digest('hex')
  return join(root, id, 'index.db')
}

export function registerContext(cwd: string, root = indexes()): void {
  const path = join(root, 'registry.json')
  const contexts = readContexts(path)
  const context = join(resolve(cwd), '.larify')
  if (contexts.includes(context)) return
  writeContexts(path, [...contexts, context])
}

export function cleanContextRegistry(root = indexes()): void {
  const path = join(root, 'registry.json')
  if (!existsSync(path)) return
  writeContexts(path, [...new Set(readContexts(path).filter(existsSync))])
}

function readContexts(path: string): string[] {
  try {
    const contexts = JSON.parse(readFileSync(path, 'utf8')).contexts
    return Array.isArray(contexts)
      ? contexts.filter((context): context is string => typeof context === 'string')
      : []
  } catch {
    return []
  }
}

function writeContexts(path: string, contexts: string[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ contexts }, null, 2))
}
