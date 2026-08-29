import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  clearCredentials: vi.fn(),
  closeCallback: vi.fn(),
  discovery: vi.fn(),
  fetchUserInfo: vi.fn(),
  loadCredentials: vi.fn(),
  openExternal: vi.fn(),
  openLoopbackCallback: vi.fn(),
  randomNonce: vi.fn(),
  randomPKCECodeVerifier: vi.fn(),
  randomState: vi.fn(),
  refreshTokenGrant: vi.fn(),
  saveCredentials: vi.fn(),
  tokenRevocation: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('openid-client', () => ({
  customFetch: Symbol('customFetch'),
  authorizationCodeGrant: mocks.authorizationCodeGrant,
  buildAuthorizationUrl: mocks.buildAuthorizationUrl,
  calculatePKCECodeChallenge: mocks.calculatePKCECodeChallenge,
  discovery: mocks.discovery,
  fetchUserInfo: mocks.fetchUserInfo,
  randomNonce: mocks.randomNonce,
  randomPKCECodeVerifier: mocks.randomPKCECodeVerifier,
  randomState: mocks.randomState,
  refreshTokenGrant: mocks.refreshTokenGrant,
  tokenRevocation: mocks.tokenRevocation
}))

vi.mock('../../../src/main/auth/credential-store', () => ({
  clearCredentials: mocks.clearCredentials,
  loadCredentials: mocks.loadCredentials,
  saveCredentials: mocks.saveCredentials
}))

vi.mock('../../../src/main/auth/loopback', () => ({
  openLoopbackCallback: mocks.openLoopbackCallback
}))

import { AuthService } from '../../../src/main/auth/service'

describe('AuthService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.discovery.mockResolvedValue({})
    mocks.randomPKCECodeVerifier.mockReturnValue('verifier')
    mocks.randomState.mockReturnValue('state')
    mocks.randomNonce.mockReturnValue('nonce')
    mocks.calculatePKCECodeChallenge.mockResolvedValue('challenge')
    mocks.buildAuthorizationUrl.mockReturnValue(new URL('https://larify.ai/authorize'))
    mocks.openLoopbackCallback.mockResolvedValue({
      redirectUri: 'http://127.0.0.1:12345/callback',
      result: Promise.resolve(new URL('http://127.0.0.1:12345/callback?code=code&state=state')),
      close: mocks.closeCallback
    })
  })

  it('becomes unauthenticated without contacting the issuer when no session is stored', async () => {
    mocks.loadCredentials.mockResolvedValue(null)

    const service = new AuthService()
    await service.restore()

    expect(service.getState()).toEqual({ status: 'unauthenticated' })
    expect(mocks.discovery).not.toHaveBeenCalled()
  })

  it('restores a stored session and persists a rotated refresh token', async () => {
    mocks.loadCredentials.mockResolvedValue({
      refreshToken: 'refresh-old',
      user: { id: 'user-1', email: 'old@example.com' }
    })
    mocks.refreshTokenGrant.mockResolvedValue({
      access_token: 'access-new',
      refresh_token: 'refresh-new'
    })
    mocks.fetchUserInfo.mockResolvedValue({ sub: 'user-1', email: 'new@example.com' })

    const service = new AuthService()
    await service.restore()

    expect(service.getState()).toEqual({
      status: 'authenticated',
      user: { id: 'user-1', email: 'new@example.com' }
    })
    expect(mocks.saveCredentials).toHaveBeenCalledWith({
      refreshToken: 'refresh-new',
      user: { id: 'user-1', email: 'new@example.com' }
    })
  })

  it('clears an expired stored session', async () => {
    mocks.loadCredentials.mockResolvedValue({
      refreshToken: 'refresh-expired',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    mocks.refreshTokenGrant.mockRejectedValue({ error: 'invalid_grant' })

    const service = new AuthService()
    await service.restore()

    expect(mocks.clearCredentials).toHaveBeenCalledOnce()
    expect(service.getState().status).toBe('unauthenticated')
  })

  it('leaves the restoring state when an expired credential cannot be deleted', async () => {
    mocks.loadCredentials.mockResolvedValue({
      refreshToken: 'refresh-expired',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    mocks.refreshTokenGrant.mockRejectedValue({ error: 'invalid_grant' })
    mocks.clearCredentials.mockRejectedValue(new Error('file is locked'))

    const service = new AuthService()
    await service.restore()

    expect(service.getState()).toEqual({
      status: 'unauthenticated',
      error: '登录状态已失效，请重新登录。'
    })
  })

  it('completes one PKCE login for concurrent callers', async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      claims: () => ({ sub: 'user-1' })
    })
    mocks.fetchUserInfo.mockResolvedValue({ sub: 'user-1', email: 'user@example.com' })

    const service = new AuthService()
    const first = service.login()
    const second = service.login()

    expect(first).toBe(second)
    await expect(first).resolves.toEqual({
      status: 'authenticated',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    expect(mocks.openLoopbackCallback).toHaveBeenCalledOnce()
    expect(mocks.buildAuthorizationUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: 'openid email offline_access',
        code_challenge_method: 'S256',
        prompt: 'login'
      })
    )
    expect(mocks.saveCredentials).toHaveBeenCalledWith({
      refreshToken: 'refresh-token',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    expect(mocks.closeCallback).toHaveBeenCalledOnce()
  })

  it('rejects an authorization response without a refresh token and closes the callback', async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'access-token',
      claims: () => ({ sub: 'user-1' })
    })

    const service = new AuthService()

    await expect(service.login()).resolves.toEqual({
      status: 'unauthenticated',
      error: '暂时无法连接登录服务，请稍后重试。'
    })
    expect(mocks.saveCredentials).not.toHaveBeenCalled()
    expect(mocks.closeCallback).toHaveBeenCalledOnce()
  })

  it('reports a local callback startup failure without rejecting login', async () => {
    mocks.openLoopbackCallback.mockRejectedValue(new Error('Unable to start callback server.'))

    const service = new AuthService()

    await expect(service.login()).resolves.toEqual({
      status: 'unauthenticated',
      error: '暂时无法连接登录服务，请稍后重试。'
    })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('reports a browser launch failure and closes the callback', async () => {
    mocks.openExternal.mockRejectedValue(new Error('browser unavailable'))

    const service = new AuthService()

    await expect(service.login()).resolves.toMatchObject({ status: 'unauthenticated' })
    expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled()
    expect(mocks.closeCallback).toHaveBeenCalledOnce()
  })

  it('reports a callback timeout and closes the callback', async () => {
    mocks.openLoopbackCallback.mockResolvedValue({
      redirectUri: 'http://127.0.0.1:12345/callback',
      result: Promise.reject(new Error('Login timed out.')),
      close: mocks.closeCallback
    })

    const service = new AuthService()

    await expect(service.login()).resolves.toEqual({
      status: 'unauthenticated',
      error: '登录已超时，请重试。'
    })
    expect(mocks.closeCallback).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: 'identity',
      tokens: { access_token: 'access-token', refresh_token: 'refresh-token', claims: () => ({}) },
      userInfo: undefined
    },
    {
      name: 'email',
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        claims: () => ({ sub: 'user-1' })
      },
      userInfo: { sub: 'user-1' }
    }
  ])('does not persist a login response without a user $name', async ({ tokens, userInfo }) => {
    mocks.authorizationCodeGrant.mockResolvedValue(tokens)
    if (userInfo) mocks.fetchUserInfo.mockResolvedValue(userInfo)

    const service = new AuthService()

    await expect(service.login()).resolves.toMatchObject({ status: 'unauthenticated' })
    expect(mocks.saveCredentials).not.toHaveBeenCalled()
  })

  it('logs out locally even when token revocation fails', async () => {
    mocks.loadCredentials.mockResolvedValue({
      refreshToken: 'refresh-token',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    mocks.refreshTokenGrant.mockResolvedValue({ access_token: 'access-token' })
    mocks.fetchUserInfo.mockResolvedValue({ sub: 'user-1', email: 'user@example.com' })
    mocks.tokenRevocation.mockRejectedValue(new Error('offline'))

    const service = new AuthService()
    await service.restore()
    await service.logout()

    expect(mocks.clearCredentials).toHaveBeenCalledOnce()
    expect(service.getState()).toEqual({ status: 'unauthenticated' })
  })

  it('does not partially log out when stored credentials cannot be deleted', async () => {
    mocks.loadCredentials.mockResolvedValue({
      refreshToken: 'refresh-token',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    mocks.refreshTokenGrant.mockResolvedValue({ access_token: 'access-token' })
    mocks.fetchUserInfo.mockResolvedValue({ sub: 'user-1', email: 'user@example.com' })

    const service = new AuthService()
    await service.restore()
    mocks.clearCredentials.mockRejectedValue(new Error('file is locked'))

    await expect(service.logout()).rejects.toThrow('file is locked')
    expect(service.getState()).toEqual({
      status: 'authenticated',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    expect(mocks.tokenRevocation).not.toHaveBeenCalled()
  })

  it('does not retain a refresh token when credential persistence fails', async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      claims: () => ({ sub: 'user-1' })
    })
    mocks.fetchUserInfo.mockResolvedValue({ sub: 'user-1', email: 'user@example.com' })
    mocks.saveCredentials.mockRejectedValue(new Error('disk is full'))

    const service = new AuthService()
    await expect(service.login()).resolves.toMatchObject({ status: 'unauthenticated' })
    await service.logout()

    expect(mocks.tokenRevocation).not.toHaveBeenCalled()
  })

  it('keeps a completed login when a state listener throws', async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      claims: () => ({ sub: 'user-1' })
    })
    mocks.fetchUserInfo.mockResolvedValue({ sub: 'user-1', email: 'user@example.com' })

    const service = new AuthService()
    service.subscribe(() => {
      throw new Error('renderer unavailable')
    })

    await expect(service.login()).resolves.toEqual({
      status: 'authenticated',
      user: { id: 'user-1', email: 'user@example.com' }
    })
    expect(service.getState().status).toBe('authenticated')
  })

  it('stops notifying an unsubscribed listener', async () => {
    mocks.loadCredentials.mockResolvedValue(null)
    const listener = vi.fn()
    const service = new AuthService()
    const unsubscribe = service.subscribe(listener)

    unsubscribe()
    await service.restore()

    expect(listener).not.toHaveBeenCalled()
  })
})
