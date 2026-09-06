import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { waitForMcpAuthorizationCode } from '../../../src/main/auth/mcp-oauth-callback'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
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
  shell: { openExternal: vi.fn() }
}))

/** Find a free loopback port so tests never collide with the real 8123 callback. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

async function redirectUrl(pathname = '/callback'): Promise<string> {
  return `http://127.0.0.1:${await freePort()}${pathname}`
}

describe('waitForMcpAuthorizationCode', () => {
  it('captures the code, state and iss from /callback', async () => {
    const redirect = await redirectUrl()
    const pending = waitForMcpAuthorizationCode(redirect)

    const url = new URL(redirect)
    url.searchParams.set('code', 'auth-code')
    url.searchParams.set('state', 'csrf-state')
    url.searchParams.set('iss', 'https://iss.example.com')

    const response = await fetch(url.href)
    expect(response.ok).toBe(true)

    await expect(pending).resolves.toEqual({
      code: 'auth-code',
      state: 'csrf-state',
      iss: 'https://iss.example.com'
    })
  })

  it('rejects when the callback carries an authorization error', async () => {
    const redirect = await redirectUrl()
    const pending = waitForMcpAuthorizationCode(redirect)
    // Attach the rejection handler BEFORE the fetch triggers it, so the promise
    // never sits in an "unhandled rejection" state.
    const rejected = expect(pending).rejects.toThrow(/Authorization failed: access_denied/)

    const url = new URL(redirect)
    url.searchParams.set('error', 'access_denied')

    const response = await fetch(url.href)
    expect(response.status).toBe(400)

    await rejected
  })
})
