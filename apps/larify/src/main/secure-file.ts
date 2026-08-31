import { safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Encrypted-JSON file helpers built on Electron's safeStorage.
 * Shared by the auth session store (auth.json) and the New API model
 * credential cache (model-api.json).
 *
 * Read semantics: a missing file yields null; any other failure
 * (decryption or JSON parse) is rethrown so callers can decide whether
 * corruption is fatal (auth session) or merely a cache miss (model-api).
 */
export async function readEncryptedJson(path: string): Promise<unknown | null> {
  if (!isSecureStorageAvailable()) return null
  let encoded: string
  try {
    encoded = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64')))
}

export async function writeEncryptedJson(path: string, value: unknown): Promise<void> {
  if (!isSecureStorageAvailable()) {
    throw new Error('Secure credential storage is unavailable.')
  }
  const temporary = `${path}.tmp`
  await mkdir(dirname(path), { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64')
  try {
    await writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function clearEncryptedJson(path: string): Promise<void> {
  await Promise.all([rm(path, { force: true }), rm(`${path}.tmp`, { force: true })])
}

const isSecureStorageAvailable = (): boolean =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
