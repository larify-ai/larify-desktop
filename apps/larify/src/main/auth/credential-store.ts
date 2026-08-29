import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { AuthUser } from '@shared/auth'

export interface StoredCredentials {
  refreshToken: string
  user: AuthUser
}

const credentialsPath = (): string => join(app.getPath('userData'), 'auth.json')

export async function loadCredentials(): Promise<StoredCredentials | null> {
  if (!isSecureCredentialStorageAvailable()) return null
  try {
    const encoded = await readFile(credentialsPath(), 'utf8')
    return parseCredentials(safeStorage.decryptString(Buffer.from(encoded, 'base64')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  if (!isSecureCredentialStorageAvailable()) {
    throw new Error('Secure credential storage is unavailable.')
  }
  const target = credentialsPath()
  const temporary = `${target}.tmp`
  await mkdir(dirname(target), { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials)).toString('base64')
  try {
    await writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function clearCredentials(): Promise<void> {
  const target = credentialsPath()
  await Promise.all([rm(target, { force: true }), rm(`${target}.tmp`, { force: true })])
}

function parseCredentials(value: string): StoredCredentials {
  const parsed: unknown = JSON.parse(value)
  if (
    !isRecord(parsed) ||
    !isNonEmptyString(parsed.refreshToken) ||
    !isRecord(parsed.user) ||
    !isNonEmptyString(parsed.user.id) ||
    !isNonEmptyString(parsed.user.email)
  ) {
    throw new Error('Stored credentials are invalid.')
  }
  return {
    refreshToken: parsed.refreshToken,
    user: { id: parsed.user.id, email: parsed.user.email }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const isSecureCredentialStorageAvailable = (): boolean =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
