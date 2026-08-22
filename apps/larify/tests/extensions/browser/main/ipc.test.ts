import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
  error: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      h.handlers.set(channel, handler),
    on: (channel: string, listener: (...args: unknown[]) => unknown) =>
      h.listeners.set(channel, listener),
    removeListener: (channel: string, listener: (...args: unknown[]) => unknown) => {
      if (h.listeners.get(channel) === listener) h.listeners.delete(channel)
    },
    removeHandler: (channel: string) => h.handlers.delete(channel)
  }
}))

import { registerBrowserIpc } from '../../../../src/extensions/browser/main/ipc'
import type { BrowserService } from '../../../../src/extensions/browser/main/browser-service'

const sender = (
  destroyed = false
): {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
  once: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  destroy(): void
} => ({
  isDestroyed: () => destroyed,
  send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }),
  once: vi.fn(),
  off: vi.fn(),
  destroy() {
    const listener = this.once.mock.calls.find(([event]) => event === 'destroyed')?.[1]
    listener?.()
  }
})

function fakeService(): BrowserService {
  return {
    bindChange: vi.fn(() => vi.fn()),
    tab: vi.fn(() => ({ state: () => ({ id: 7, title: 'Page' }) })),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn()
  } as unknown as BrowserService
}

describe('registerBrowserIpc', () => {
  beforeEach(() => {
    h.handlers.clear()
    h.listeners.clear()
    h.sent.length = 0
    h.error.mockReset()
    vi.spyOn(console, 'error').mockImplementation(h.error)
  })

  it('registers only resource operations and browser-specific commands', () => {
    registerBrowserIpc(fakeService())
    expect([...h.handlers.keys()].sort()).toEqual([
      'browser:back',
      'browser:forward',
      'browser:getState',
      'browser:navigate',
      'browser:reload',
      'browser:setVisible'
    ])
    expect(h.handlers.has('browser:create')).toBe(false)
    expect(h.handlers.has('browser:close')).toBe(false)
  })

  it('routes commands by resource id', async () => {
    const service = fakeService()
    registerBrowserIpc(service)
    h.handlers.get('browser:navigate')!({ sender: sender() }, 'session-a', 7, 'openai.com')
    h.handlers.get('browser:back')!({ sender: sender() }, 'session-a', 7)
    h.handlers.get('browser:forward')!({ sender: sender() }, 'session-a', 7)
    h.handlers.get('browser:reload')!({ sender: sender() }, 'session-a', 7)
    h.handlers.get('browser:setVisible')!({ sender: sender() }, 'session-a', 7, true)
    const event = { returnValue: null }
    h.listeners.get('browser:setBoundsSync')!(
      event,
      'session-a',
      7,
      { x: 1, y: 2, width: 300, height: 200 },
      false,
      false
    )
    expect(service.navigate).toHaveBeenCalledWith('session-a', 7, 'openai.com')
    expect(service.goBack).toHaveBeenCalledWith('session-a', 7)
    expect(service.goForward).toHaveBeenCalledWith('session-a', 7)
    expect(service.reload).toHaveBeenCalledWith('session-a', 7)
    expect(service.setVisible).toHaveBeenCalledWith('session-a', 7, true)
    expect(service.setBounds).toHaveBeenCalledWith(
      'session-a',
      7,
      { x: 1, y: 2, width: 300, height: 200 },
      false,
      false
    )
    expect(event.returnValue).toBe(true)
  })

  it('always replies to synchronous bounds updates when the service fails', () => {
    const service = fakeService()
    const error = new Error('view was destroyed')
    vi.mocked(service.setBounds).mockImplementation(() => {
      throw error
    })
    registerBrowserIpc(service)
    const event = { returnValue: null as unknown }

    expect(() =>
      h.listeners.get('browser:setBoundsSync')!(
        event,
        'session-a',
        7,
        { x: 1, y: 2, width: 300, height: 200 },
        false
      )
    ).not.toThrow()
    expect(event.returnValue).toBe(false)
    expect(h.error).toHaveBeenCalledWith('[browser] Failed to update bounds:', error)
  })

  it('forwards live resize and activation flags', () => {
    const service = fakeService()
    registerBrowserIpc(service)
    const event = { returnValue: null as unknown }

    h.listeners.get('browser:setBoundsSync')!(
      event,
      'session-a',
      7,
      { x: 5, y: 6, width: 300, height: 200 },
      true,
      true
    )

    expect(service.setBounds).toHaveBeenCalledWith(
      'session-a',
      7,
      { x: 5, y: 6, width: 300, height: 200 },
      true,
      true
    )
    expect(event.returnValue).toBe(true)
  })

  it('returns one resource state and subscribes for changes', () => {
    const service = fakeService()
    const webContents = sender()
    registerBrowserIpc(service)
    expect(
      h.handlers.get('browser:getState')!({ sender: webContents }, 'session-a', 7)
    ).toMatchObject({
      id: 7,
      title: 'Page'
    })
    const listener = vi.mocked(service.bindChange).mock.calls[0][0]
    listener('session-a', { tabs: [], activeId: null })
    expect(h.sent).toEqual([
      {
        channel: 'browser:state',
        payload: { sessionId: 'session-a', state: { tabs: [], activeId: null } }
      }
    ])
  })

  it('subscribes once and stops sending after the renderer is destroyed', () => {
    const service = fakeService()
    const webContents = sender()
    registerBrowserIpc(service)
    const getState = h.handlers.get('browser:getState')!
    getState({ sender: webContents }, 'session-a', 7)
    getState({ sender: webContents }, 'session-a', 7)
    expect(webContents.once).toHaveBeenCalledTimes(1)

    webContents.destroy()
    const listener = vi.mocked(service.bindChange).mock.calls[0][0]
    listener('session-a', { tabs: [], activeId: null })
    expect(h.sent).toEqual([])
  })

  it('removes the destroyed listener when broadcasting finds a dead renderer', () => {
    const service = fakeService()
    const webContents = sender(true)
    registerBrowserIpc(service)
    h.handlers.get('browser:getState')!({ sender: webContents }, 'session-a', 7)

    const listener = vi.mocked(service.bindChange).mock.calls[0][0]
    listener('session-a', { tabs: [], activeId: null })

    expect(webContents.off).toHaveBeenCalledWith('destroyed', expect.any(Function))
    expect(h.sent).toEqual([])
  })

  it('stops broadcasting to a renderer after send fails', () => {
    const service = fakeService()
    const webContents = sender()
    webContents.send = vi.fn(() => {
      throw new Error('renderer was destroyed')
    })
    registerBrowserIpc(service)
    h.handlers.get('browser:getState')!({ sender: webContents }, 'session-a', 7)

    const listener = vi.mocked(service.bindChange).mock.calls[0][0]
    listener('session-a', { tabs: [], activeId: null })
    listener('session-a', { tabs: [], activeId: null })

    expect(webContents.send).toHaveBeenCalledOnce()
    expect(webContents.off).toHaveBeenCalledWith('destroyed', expect.any(Function))
  })

  it('removes handlers on disposal', () => {
    const service = fakeService()
    const unbind = vi.fn()
    vi.mocked(service.bindChange).mockReturnValue(unbind)
    const dispose = registerBrowserIpc(service)
    dispose()
    expect(unbind).toHaveBeenCalledOnce()
    expect(h.handlers.size).toBe(0)
    expect(h.listeners.size).toBe(0)
  })
})
