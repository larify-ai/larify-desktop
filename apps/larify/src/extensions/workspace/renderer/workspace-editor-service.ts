import {
  observeActiveWorkspaceFile as observeMonacoActiveWorkspaceFile,
  openWorkspaceFile as openMonacoWorkspaceFile,
  setWorkspaceRoot,
  setWorkspaceTheme as setMonacoWorkspaceTheme
} from './monaco'
import { workspaceClient } from './workspace-client'

let workspaceRoot: string | null = null
let rootQueue = Promise.resolve()
let openQueue = Promise.resolve()

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
      await workspaceClient.open(root)
      await setWorkspaceRoot(root)
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
    .then(async () => {
      const start = `larify:open-file:start:${crypto.randomUUID()}`
      performance.mark(start)
      try {
        await prepareWorkspaceRoot(root)
        const target = isInsideWorkspace(root, file) ? file : await workspaceClient.allowFile(file)
        await openMonacoWorkspaceFile(target)
        performance.measure('larify:open-file', start)
      } finally {
        performance.clearMarks(start)
      }
    })
  openQueue = request
  return request
}

export async function setWorkspaceTheme(theme: 'dark' | 'light'): Promise<void> {
  return setMonacoWorkspaceTheme(theme)
}
