import { app, safeStorage } from 'electron'
import { join } from 'node:path'

import type { AuthUser } from '@shared/auth'
import { clearEncryptedJson, readEncryptedJson, writeEncryptedJson } from '../secure-file'

export interface StoredCredentials {
  refreshToken: string
  user: AuthUser
}

const credentialsPath = (): string => join(app.getPath('userData'), 'auth.json')

export async function loadCredentials(): Promise<StoredCredentials | null> {
  if (!safeStorage.isEncryptionAvailable()) return null
  const parsed = await readEncryptedJson(credentialsPath())
  if (parsed === null) return null
  return parseCredentials(parsed)
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await writeEncryptedJson(credentialsPath(), credentials)
}

export async function clearCredentials(): Promise<void> {
  await clearEncryptedJson(credentialsPath())
}

function parseCredentials(value: unknown): StoredCredentials {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.refreshToken) ||
    !isRecord(value.user) ||
    !isNonEmptyString(value.user.id) ||
    !isNonEmptyString(value.user.email)
  ) {
    throw new Error('Stored credentials are invalid.')
  }
  return {
    refreshToken: value.refreshToken,
    user: { id: value.user.id, email: value.user.email }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0
