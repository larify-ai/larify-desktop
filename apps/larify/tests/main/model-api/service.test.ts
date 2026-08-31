import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(() => '/tmp/larify-user-data'),
  fetch: vi.fn(),
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
  decryptString: vi.fn((buffer: Buffer) => Buffer.from(buffer).toString('utf8')),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
  getAccessToken: vi.fn(),
  getState: vi.fn(() => ({ status: 'authenticated' })),
  getAuthService: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  net: { fetch: mocks.fetch },
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString
  }
}))

vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  readFile: mocks.readFile,
  rename: mocks.rename,
  rm: mocks.rm,
  writeFile: mocks.writeFile
}))

vi.mock('../../../src/main/auth/service', () => ({
  getAuthService: mocks.getAuthService
}))

import { ModelApiService } from '../../../src/main/model-api/service'

const CREDENTIALS = { baseUrl: 'https://api.larify.ai', apiKey: 'sk-test-123' }

function ok(body: unknown): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: () => Promise.resolve(body) }
}

function fail(status: number, body: unknown): { ok: false; json: () => Promise<unknown> } {
  return { ok: false, json: () => Promise.resolve(body) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.rename.mockResolvedValue(undefined)
  mocks.rm.mockResolvedValue(undefined)
  mocks.getAccessToken.mockResolvedValue('access-token')
  mocks.getState.mockReturnValue({ status: 'authenticated' })
  mocks.getAuthService.mockReturnValue({
    getAccessToken: mocks.getAccessToken,
    getState: mocks.getState
  })
})

describe('ModelApiService', () => {
  describe('getCredentials', () => {
    it('fetches, caches and persists the credentials', async () => {
      mocks.fetch.mockResolvedValue(ok(CREDENTIALS))

      const service = new ModelApiService()

      await expect(service.getCredentials()).resolves.toEqual(CREDENTIALS)
      expect(service.getCachedCredentialsSync()).toEqual(CREDENTIALS)
      expect(mocks.fetch).toHaveBeenCalledWith(
        'https://larify.ai/api/new-api/credentials',
        expect.objectContaining({ headers: { authorization: 'Bearer access-token' } })
      )
      expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    })

    it('throws a sign-in message when not authenticated', async () => {
      mocks.getAccessToken.mockResolvedValue(null)
      mocks.getState.mockReturnValue({ status: 'unauthenticated' })

      const service = new ModelApiService()

      await expect(service.getCredentials()).rejects.toThrow('请先登录后再使用模型功能。')
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('reports a failed token refresh separately from being signed out', async () => {
      mocks.getAccessToken.mockResolvedValue(null)

      const service = new ModelApiService()

      await expect(service.getCredentials()).rejects.toThrow('登录状态刷新失败，请稍后重试。')
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('surfaces the upstream error message on failure', async () => {
      mocks.fetch.mockResolvedValue(fail(401, { error: 'invalid credentials' }))

      const service = new ModelApiService()

      await expect(service.getCredentials()).rejects.toThrow('invalid credentials')
    })

    it('rejects malformed credential payloads', async () => {
      mocks.fetch.mockResolvedValue(ok({ baseUrl: 'https://x' }))

      const service = new ModelApiService()

      await expect(service.getCredentials()).rejects.toThrow('模型服务返回了无效的凭据。')
    })
  })

  describe('getBalance', () => {
    it('returns the balance payload', async () => {
      const balance = { wallet: { quota: 100, usedQuota: 10 }, subscriptions: [] }
      mocks.fetch.mockResolvedValue(ok(balance))

      const service = new ModelApiService()

      await expect(service.getBalance()).resolves.toEqual(balance)
      expect(mocks.fetch).toHaveBeenCalledWith(
        'https://larify.ai/api/new-api/balance',
        expect.objectContaining({ headers: { authorization: 'Bearer access-token' } })
      )
    })

    it('throws when signed out', async () => {
      mocks.getAccessToken.mockResolvedValue(null)
      mocks.getState.mockReturnValue({ status: 'unauthenticated' })

      const service = new ModelApiService()

      await expect(service.getBalance()).rejects.toThrow('请先登录后再使用模型功能。')
    })
  })

  describe('persistence', () => {
    it('loads a valid cached credential file during init', async () => {
      const encoded = Buffer.from(JSON.stringify(CREDENTIALS)).toString('base64')
      mocks.readFile.mockResolvedValue(encoded)

      const service = new ModelApiService()
      await service.init()

      expect(service.getCachedCredentialsSync()).toEqual(CREDENTIALS)
    })

    it('ignores a corrupt cache file during init', async () => {
      mocks.readFile.mockRejectedValue(new Error('bad file'))

      const service = new ModelApiService()
      await service.init()

      expect(service.getCachedCredentialsSync()).toBeNull()
    })

    it('clears the cached credentials and the file on clear', async () => {
      mocks.fetch.mockResolvedValue(ok(CREDENTIALS))

      const service = new ModelApiService()
      await service.getCredentials()
      expect(service.getCachedCredentialsSync()).toEqual(CREDENTIALS)

      await service.clear()
      expect(service.getCachedCredentialsSync()).toBeNull()
      expect(mocks.rm).toHaveBeenCalled()
    })
  })
})
