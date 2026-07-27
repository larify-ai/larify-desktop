import {
  observeActiveWorkspaceFile as observeMonacoActiveWorkspaceFile,
  openWorkspaceDiff as openMonacoWorkspaceDiff,
  openWorkspaceHighlightedDiff as openMonacoWorkspaceHighlightedDiff,
  openWorkspaceFile as openMonacoWorkspaceFile,
  setWorkspaceRoot,
  setWorkspaceTheme as setMonacoWorkspaceTheme
} from './monaco'
import { workspaceClient } from './workspace-client'

let workspaceRoot: string | null = null
let rootQueue = Promise.resolve()
let openQueue = Promise.resolve()

const measure = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  const start = `${name}:start:${crypto.randomUUID()}`
  performance.mark(start)
  try {
    return await operation()
  } finally {
    performance.measure(name, start)
    performance.clearMarks(start)
  }
}

const normalizePath = (value: string): string =>
  value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

const isInsideWorkspace = (root: string, file: string): boolean => {
  const normalizedRoot = normalizePath(root)
  const normalizedFile = normalizePath(file)
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`)
}

export async function prepareWorkspaceRoot(root: string): Promise<void> {
  const request = rootQueue
    .catch(() => undefined)
    .then(async () => {
      if (workspaceRoot === root) return
      await measure('larify:prepare-workspace-editor', async () => {
        await workspaceClient.open(root)
        await setWorkspaceRoot(root)
      })
      workspaceRoot = root
    })
  rootQueue = request
  await request
}

export async function observeActiveWorkspaceFile(
  onChange: (file: string | null) => void
): Promise<() => void> {
  return observeMonacoActiveWorkspaceFile(onChange)
}

export function openWorkspaceFile(root: string, file: string): Promise<void> {
  const request = openQueue
    .catch(() => undefined)
    .then(() =>
      measure('larify:open-file', async () => {
        await prepareWorkspaceRoot(root)
        const target = isInsideWorkspace(root, file) ? file : await workspaceClient.allowFile(file)
        await openMonacoWorkspaceFile(target)
      })
    )
  openQueue = request
  return request
}

export function openWorkspaceDiff(root: string, file: string): Promise<void> {
  const request = openQueue
    .catch(() => undefined)
    .then(() =>
      measure('larify:open-diff', async () => {
        await prepareWorkspaceRoot(root)
        await openMonacoWorkspaceDiff(file)
      })
    )
  openQueue = request
  return request
}

export function openWorkspaceHighlightedDiff(
  root: string,
  file: string,
  patch: string
): Promise<void> {
  const request = openQueue
    .catch(() => undefined)
    .then(async () => {
      await prepareWorkspaceRoot(root)
      await openMonacoWorkspaceHighlightedDiff(file, patch)
    })
  openQueue = request
  return request
}

export async function setWorkspaceTheme(theme: 'dark' | 'light'): Promise<void> {
  return setMonacoWorkspaceTheme(theme)
}
