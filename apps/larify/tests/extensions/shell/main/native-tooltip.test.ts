import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const windows: FakeWindow[] = []
  let loadError: Error | undefined

  class FakeWindow {
    readonly listeners = new Map<string, Set<() => void>>()
    destroyed = false
    webContents = {
      executeJavaScript: vi.fn().mockResolvedValue({ height: 20, width: 100 })
    }

    constructor() {
      windows.push(this)
    }

    on(event: string, listener: () => void): void {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
    }

    removeListener(event: string, listener: () => void): void {
      this.listeners.get(event)?.delete(listener)
    }

    emit(event: string): void {
      for (const listener of this.listeners.get(event) ?? []) listener()
    }

    loadURL = vi.fn(() => (loadError ? Promise.reject(loadError) : Promise.resolve(undefined)))
    showInactive = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    setOpacity = vi.fn()
    setBounds = vi.fn()
    isDestroyed = (): boolean => this.destroyed
    destroy = vi.fn(() => {
      this.destroyed = true
    })
  }

  return {
    FakeWindow,
    failNextLoad(error: Error): void {
      loadError = error
    },
    reset(): void {
      loadError = undefined
      windows.length = 0
    },
    windows
  }
})

vi.mock('electron', () => ({ BrowserWindow: h.FakeWindow }))

import { NativeTooltip } from '../../../../src/extensions/shell/main/native-tooltip'

describe('NativeTooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.reset()
  })

  it('is destroyed with its owner and removes owner listeners', () => {
    const owner = new h.FakeWindow()
    const tooltip = new NativeTooltip(owner as never)

    expect(tooltip.isOwnedBy(owner as never)).toBe(true)
    expect(owner.listeners.get('closed')?.size).toBe(1)

    owner.emit('closed')

    expect(tooltip.isDestroyed()).toBe(true)
    expect(owner.listeners.get('closed')?.size).toBe(0)
  })

  it('ignores invalid screen coordinates', async () => {
    const owner = new h.FakeWindow()
    const tooltip = new NativeTooltip(owner as never)

    await tooltip.show({
      background: '#000',
      fontFamily: 'sans-serif',
      foreground: '#fff',
      label: '浏览',
      radius: '8px',
      x: Number.NaN,
      y: 10
    })

    expect(h.windows[1].webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('ignores a failed tooltip document load', async () => {
    const owner = new h.FakeWindow()
    h.failNextLoad(new Error('load failed'))
    const tooltip = new NativeTooltip(owner as never)

    await expect(
      tooltip.show({
        background: '#000',
        fontFamily: 'sans-serif',
        foreground: '#fff',
        label: '浏览',
        radius: '8px',
        x: 10,
        y: 10
      })
    ).resolves.toBeUndefined()

    expect(tooltip.isDestroyed()).toBe(true)
    expect(h.windows[1].webContents.executeJavaScript).not.toHaveBeenCalled()
  })
})
