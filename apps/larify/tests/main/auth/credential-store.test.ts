import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  encryptionAvailable: true,
  storageBackend: 'gnome_libsecret',
  userDataPath: ''
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userDataPath },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    getSelectedStorageBackend: () => mocks.storageBackend,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => {
      const decoded = value.toString()
      if (!decoded.startsWith('encrypted:')) throw new Error('invalid ciphertext')
      return decoded.slice('encrypted:'.length)
    }
  }
}))

import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  type StoredCredentials
} from '../../../src/main/auth/credential-store'

const first: StoredCredentials = {
  refreshToken: 'refresh-1',
  user: { id: 'user-1', email: 'first@example.com' }
}

describe('credential store', () => {
  beforeEach(async () => {
    mocks.encryptionAvailable = true
    mocks.storageBackend = 'gnome_libsecret'
    mocks.userDataPath = await mkdtemp(join(tmpdir(), 'larify-auth-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(mocks.userDataPath, { recursive: true, force: true })
  })

  it('returns null when no credentials exist', async () => {
    await expect(loadCredentials()).resolves.toBeNull()
  })

  it('encrypts, loads, and replaces stored credentials', async () => {
    await saveCredentials(first)
    expect(await readFile(join(mocks.userDataPath, 'auth.json'), 'utf8')).not.toContain(
      first.refreshToken
    )
    await expect(loadCredentials()).resolves.toEqual(first)

    const replacement: StoredCredentials = {
      refreshToken: 'refresh-2',
      user: { id: 'user-2', email: 'second@example.com' }
    }
    await saveCredentials(replacement)

    await expect(loadCredentials()).resolves.toEqual(replacement)
  })

  it('removes stored credentials', async () => {
    await saveCredentials(first)
    await writeFile(join(mocks.userDataPath, 'auth.json.tmp'), 'stale')
    await clearCredentials()

    await expect(loadCredentials()).resolves.toBeNull()
    await expect(readFile(join(mocks.userDataPath, 'auth.json.tmp'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('rejects decrypted data with an invalid structure', async () => {
    const invalid = Buffer.from('encrypted:{"refreshToken":"refresh-1"}').toString('base64')
    await writeFile(join(mocks.userDataPath, 'auth.json'), invalid)

    await expect(loadCredentials()).rejects.toThrow('Stored credentials are invalid.')
  })

  it('does not read or write credentials without secure storage', async () => {
    mocks.encryptionAvailable = false

    await expect(loadCredentials()).resolves.toBeNull()
    await expect(saveCredentials(first)).rejects.toThrow(
      'Secure credential storage is unavailable.'
    )
  })

  it('rejects the insecure Linux basic-text backend', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    mocks.storageBackend = 'basic_text'

    await expect(loadCredentials()).resolves.toBeNull()
    await expect(saveCredentials(first)).rejects.toThrow(
      'Secure credential storage is unavailable.'
    )
  })

  it('removes the temporary file when replacement fails', async () => {
    await mkdir(join(mocks.userDataPath, 'auth.json'))

    await expect(saveCredentials(first)).rejects.toThrow()
    await expect(readFile(join(mocks.userDataPath, 'auth.json.tmp'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
