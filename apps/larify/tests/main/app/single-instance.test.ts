import { describe, expect, it, vi } from 'vitest'
import type { App, BrowserWindow } from 'electron'
import { acquireSingleInstanceLock } from '../../../src/main/app/single-instance'

/** 最小 App 桩：只暴露被测逻辑用到的接口。 */
function createAppStub(hasLock: boolean): {
  app: App
  quit: ReturnType<typeof vi.fn>
  emitSecondInstance: () => void
} {
  const listeners: Record<string, Array<() => void>> = {}
  const quit = vi.fn()
  const app = {
    requestSingleInstanceLock: vi.fn(() => hasLock),
    quit,
    on: vi.fn((event: string, listener: () => void) => {
      ;(listeners[event] ??= []).push(listener)
    })
  } as unknown as App
  return {
    app,
    quit,
    emitSecondInstance: () => listeners['second-instance']?.forEach((fn) => fn())
  }
}

function makeWindow(destroyed: boolean, minimized: boolean): BrowserWindow {
  return {
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  } as unknown as BrowserWindow
}

describe('acquireSingleInstanceLock', () => {
  it('拿不到锁：退出且不注册 second-instance', () => {
    const stub = createAppStub(false)
    const acquired = acquireSingleInstanceLock(stub.app, () => undefined)
    expect(acquired).toBe(false)
    expect(stub.quit).toHaveBeenCalledTimes(1)
    expect(stub.app.on).not.toHaveBeenCalled()
  })

  it('拿到锁：不退出；second-instance 时聚焦当前窗口', () => {
    const stub = createAppStub(true)
    const window = makeWindow(false, false)
    const acquired = acquireSingleInstanceLock(stub.app, () => window)
    expect(acquired).toBe(true)
    expect(stub.quit).not.toHaveBeenCalled()

    stub.emitSecondInstance()
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    stub.emitSecondInstance()
    expect(window.focus).toHaveBeenCalledTimes(2)
  })

  it('启动窗口期（窗口尚未创建）：second-instance 静默忽略、不抛错', () => {
    const stub = createAppStub(true)
    acquireSingleInstanceLock(stub.app, () => undefined)
    expect(() => stub.emitSecondInstance()).not.toThrow()
  })

  it('已销毁窗口：静默忽略', () => {
    const stub = createAppStub(true)
    const destroyed = makeWindow(true, false)
    acquireSingleInstanceLock(stub.app, () => destroyed)
    stub.emitSecondInstance()
    expect(destroyed.show).not.toHaveBeenCalled()
    expect(destroyed.focus).not.toHaveBeenCalled()
  })

  it('最小化窗口：先 restore 再 show/focus', () => {
    const stub = createAppStub(true)
    const minimized = makeWindow(false, true)
    acquireSingleInstanceLock(stub.app, () => minimized)
    stub.emitSecondInstance()
    expect(minimized.restore).toHaveBeenCalledTimes(1)
    expect(minimized.show).toHaveBeenCalledTimes(1)
    expect(minimized.focus).toHaveBeenCalledTimes(1)
  })
})
