import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { larifyPath, toPosixPath, ensureLarifyPath, larifyWorkspacePath } from './larify-paths'

export { larifyPath, toPosixPath, ensureLarifyPath, larifyWorkspacePath }

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
