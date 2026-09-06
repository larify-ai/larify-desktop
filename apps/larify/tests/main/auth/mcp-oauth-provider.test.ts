import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  userDataPath: '',
  openExternal: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => electronMocks.userDataPath },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => {
      const decoded = value.toString()
      if (!decoded.startsWith('encrypted:')) throw new Error('invalid ciphertext')
      return decoded.slice('encrypted:'.length)
    }
  },
  shell: { openExternal: electronMocks.openExternal }
}))

import { McpOAuthClientProvider } from '../../../src/main/auth/mcp-oauth-provider'

describe('McpOAuthClientProvider', () => {
  let serverId: string

  beforeEach(async () => {
    serverId = `server-${Math.random()}`
    electronMocks.userDataPath = await mkdtemp(join(tmpdir(), 'larify-mcp-oauth-'))
    electronMocks.openExternal.mockReset()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(electronMocks.userDataPath, { recursive: true, force: true })
  })

  it('advertises a native public-client metadata with the loopback redirect', () => {
    const provider = new McpOAuthClientProvider({ serverId })
    expect(provider.redirectUrl).toBe('http://127.0.0.1:8123/callback')
    expect(provider.clientMetadata).toMatchObject({
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      redirect_uris: ['http://127.0.0.1:8123/callback']
    })
  })

  it('persists tokens and client information, isolated per server', async () => {
    const provider = new McpOAuthClientProvider({ serverId })
    expect(await provider.tokens()).toBeUndefined()

    await provider.saveTokens({ access_token: 'at-1', token_type: 'Bearer' })
    await provider.saveClientInformation({ client_id: 'client-1' })

    expect(await provider.tokens()).toMatchObject({ access_token: 'at-1' })
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'client-1' })

    // A different server stays isolated.
    const other = new McpOAuthClientProvider({ serverId: 'other' })
    expect(await other.tokens()).toBeUndefined()
    expect(await other.clientInformation()).toBeUndefined()
  })

  it('round-trips the in-memory PKCE verifier and CSRF state', async () => {
    const provider = new McpOAuthClientProvider({ serverId })
    await provider.saveCodeVerifier('verifier')
    expect(await provider.codeVerifier()).toBe('verifier')

    const state = await provider.state()
    expect(state).toBeTruthy()
    await provider.saveState(state)
    expect(await provider.storedState()).toBe(state)
  })

  it('opens the browser on redirectToAuthorization', async () => {
    const provider = new McpOAuthClientProvider({ serverId })
    const url = new URL('https://auth.example.com/authorize?client_id=x')
    await provider.redirectToAuthorization(url)
    expect(electronMocks.openExternal).toHaveBeenCalledWith(url.href)
  })

  it('invalidates stored credentials', async () => {
    const provider = new McpOAuthClientProvider({ serverId })
    await provider.saveTokens({ access_token: 'at', token_type: 'Bearer' })
    await provider.saveClientInformation({ client_id: 'c' })
    await provider.invalidateCredentials('all')
    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toBeUndefined()
  })

  it('falls back to a fresh auth when the stored file is corrupt', async () => {
    const provider = new McpOAuthClientProvider({ serverId })
    // Write an unreadable (non-encrypted) blob at the provider's per-server file.
    const dir = join(electronMocks.userDataPath, 'mcp-oauth')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${encodeURIComponent(serverId)}.json`), 'not-encrypted', 'utf8')

    // The read must not throw: it treats the broken store as missing and returns
    // undefined so the client re-authorizes instead of failing permanently.
    await expect(provider.tokens()).resolves.toBeUndefined()
    await expect(provider.clientInformation()).resolves.toBeUndefined()
  })
})
