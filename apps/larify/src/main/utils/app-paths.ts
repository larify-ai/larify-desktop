import { mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

// Dev-only override: set LARIFY_HOME to point ~/.larify (tasks/memory/plugins/workspace)
// at an empty directory for isolated testing. Unset in production -> falls back to homedir().
const larifyHome = process.env.LARIFY_HOME || homedir()

export const larifyPath = (...segments: string[]): string => join(larifyHome, '.larify', ...segments)

export const toPosixPath = (path: string): string => path.replaceAll('\\', '/')

export const ensureLarifyPath = (...segments: string[]): string => {
  const path = larifyPath(...segments)
  mkdirSync(path, { recursive: true })
  return path
}

export const larifyWorkspacePath = (): string => ensureLarifyPath('workspace')

export const sessionDatabasePath = (): string => join(app.getPath('userData'), 'sessions.db')

export const backgroundSessionDatabasePath = (): string =>
  join(app.getPath('userData'), 'background-sessions.db')

export const sessionAttachmentsPath = (sessionId: string): string => {
  const path = join(app.getPath('userData'), 'attachments', sessionId)
  mkdirSync(path, { recursive: true })
  return path
}

export const larifyTempPath = (...segments: string[]): string => {
  const root = app?.getPath?.('temp') ?? tmpdir()
  const path = join(root, 'larify', ...segments)
  mkdirSync(path, { recursive: true })
  return path
}

export const resourcePath = (...segments: string[]): string => {
  const root = app?.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(process.cwd(), 'resources')
  return join(root, ...segments)
}
