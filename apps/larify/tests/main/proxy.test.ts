import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  defaultSetProxy: vi.fn(() => Promise.resolve()),
  partitionSetProxy: vi.fn(() => Promise.resolve())
}))

vi.mock('electron', () => ({
  session: {
    defaultSession: { setProxy: electron.defaultSetProxy },
    fromPartition: vi.fn(() => ({ setProxy: electron.partitionSetProxy }))
  }
}))

import { configureSystemProxy } from '../../src/main/proxy'

beforeEach(() => {
  electron.defaultSetProxy.mockClear()
  electron.partitionSetProxy.mockClear()
  // 保持代理实现静默（console.log/warn 仅诊断用）
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('configureSystemProxy', () => {
  it('sets the system proxy on the default session and the browser partition', async () => {
    await configureSystemProxy()

    expect(electron.defaultSetProxy).toHaveBeenCalledWith({ mode: 'system' })
    expect(electron.partitionSetProxy).toHaveBeenCalledWith({ mode: 'system' })
  })

  it('does not throw when a session fails to configure the proxy', async () => {
    electron.partitionSetProxy.mockRejectedValueOnce(new Error('partition unavailable'))

    await expect(configureSystemProxy()).resolves.toBeUndefined()
    // 默认会话仍然被配置，失败只影响失败方
    expect(electron.defaultSetProxy).toHaveBeenCalledWith({ mode: 'system' })
  })
})
