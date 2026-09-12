import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 主进程 AuthService 的 dev 免登录开关。
// 关键不变量：开关**只能在未打包的 dev 下生效**，打包版即使环境变量泄漏也不得绕过。
const h = vi.hoisted(() => ({
  isPackaged: { value: false },
  loadCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  refreshTokenGrant: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return h.isPackaged.value
    }
  },
  net: { fetch: vi.fn() },
  shell: { openExternal: vi.fn() }
}))
vi.mock('../../../src/main/auth/credential-store', () => ({
  loadCredentials: h.loadCredentials,
  clearCredentials: h.clearCredentials,
  saveCredentials: h.saveCredentials
}))
vi.mock('openid-client', () => ({
  refreshTokenGrant: h.refreshTokenGrant,
  discovery: vi.fn(),
  fetchUserInfo: vi.fn(),
  tokenRevocation: vi.fn()
}))

import { AuthService } from '../../../src/main/auth/service'

const ENV_KEY = 'LARIFY_DEV_NO_AUTH'

describe('AuthService dev 免登录开关', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.isPackaged.value = false
    h.loadCredentials.mockResolvedValue(null)
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('未设置环境变量时保持正常的未登录流程', async () => {
    delete process.env[ENV_KEY]
    const auth = new AuthService()

    await auth.restore()

    expect(h.loadCredentials).toHaveBeenCalled()
    expect(auth.getState()).toEqual({ status: 'unauthenticated', error: undefined })
  })

  it('dev 下设置开关后直接进入已登录，且不读取凭证', async () => {
    process.env[ENV_KEY] = '1'
    const auth = new AuthService()

    await auth.restore()

    expect(h.loadCredentials).not.toHaveBeenCalled()
    expect(h.refreshTokenGrant).not.toHaveBeenCalled()
    expect(auth.getState()).toMatchObject({ status: 'authenticated' })
  })

  it('打包版即使设置了开关也不得绕过登录（核心不变量）', async () => {
    process.env[ENV_KEY] = '1'
    h.isPackaged.value = true
    const auth = new AuthService()

    await auth.restore()

    expect(h.loadCredentials).toHaveBeenCalled()
    expect(auth.getState().status).toBe('unauthenticated')
  })

  it.each(['0', 'true', 'yes', ''])('开关只接受字符串 "1"（收到 %j 时照常登录）', async (value) => {
    process.env[ENV_KEY] = value
    const auth = new AuthService()

    await auth.restore()

    expect(h.loadCredentials).toHaveBeenCalled()
    expect(auth.getState().status).toBe('unauthenticated')
  })

  it('dev 开关下登出保持假的已登录态（没有真实会话可撤销）', async () => {
    process.env[ENV_KEY] = '1'
    const auth = new AuthService()
    await auth.restore()
    expect(auth.getState().status).toBe('authenticated')

    await auth.logout()

    expect(h.clearCredentials).not.toHaveBeenCalled()
    expect(auth.getState().status).toBe('authenticated')
  })

  it('正常登出仍会清空凭证并转为未登录', async () => {
    delete process.env[ENV_KEY]
    const auth = new AuthService()
    await auth.restore()

    await auth.logout()

    expect(h.clearCredentials).toHaveBeenCalled()
    expect(auth.getState().status).toBe('unauthenticated')
  })
})
