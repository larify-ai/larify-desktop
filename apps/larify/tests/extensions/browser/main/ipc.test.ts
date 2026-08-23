import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
  error: vi.fn(),
  fromId: vi.fn(),
  browserSession: {},
  guest: null as null | {
    hostWebContents: unknown
    getType(): string
    session: object
  }
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
  },
  session: { fromPartition: () => h.browserSession },
  webContents: { fromId: h.fromId }
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
    openUrl: vi.fn(),
    attach: vi.fn()
  } as unknown as BrowserService
}

describe('registerBrowserIpc', () => {
  beforeEach(() => {
    h.handlers.clear()
    h.listeners.clear()
    h.sent.length = 0
    h.error.mockReset()
    h.fromId.mockImplementation(() => h.guest)
    h.fromId.mockClear()
    h.guest = null
    vi.spyOn(console, 'error').mockImplementation(h.error)
  })

  it('registers only resource operations and browser-specific commands', () => {
    registerBrowserIpc(fakeService())
    expect([...h.handlers.keys()].sort()).toEqual([
      'browser:attach',
      'browser:back',
      'browser:forward',
      'browser:getState',
      'browser:navigate',
      'browser:openUrl',
      'browser:reload'
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
    expect(service.navigate).toHaveBeenCalledWith('session-a', 7, 'openai.com')
    expect(service.goBack).toHaveBeenCalledWith('session-a', 7)
    expect(service.goForward).toHaveBeenCalledWith('session-a', 7)
    expect(service.reload).toHaveBeenCalledWith('session-a', 7)
  })

  it('opens message URLs through the browser reuse operation', () => {
    const service = fakeService()
    vi.mocked(service.openUrl).mockReturnValue(7)
    registerBrowserIpc(service)

    expect(
      h.handlers.get('browser:openUrl')!({ sender: sender() }, 'session-a', 'https://example.com')
    ).toBe(7)
    expect(service.openUrl).toHaveBeenCalledWith('session-a', 'https://example.com')
  })

  it('attaches only a webview owned by the invoking renderer', () => {
    const service = fakeService()
    const host = sender()
    const guest = {
      hostWebContents: host,
      getType: () => 'webview',
      session: h.browserSession
    }
    h.guest = guest
    registerBrowserIpc(service)

    h.handlers.get('browser:attach')!({ sender: host }, 'session-a', 7, 99)
    expect(h.fromId).toHaveBeenCalledWith(99)
    expect(service.attach).toHaveBeenCalledWith('session-a', 7, guest)
    expect(() =>
      h.handlers.get('browser:attach')!({ sender: sender() }, 'session-a', 7, 99)
    ).toThrow('browser guest WebContents is unavailable')
  })

  it('rejects a guest from another webview partition or WebContents type', () => {
    const service = fakeService()
    const host = sender()
    registerBrowserIpc(service)

    h.guest = {
      hostWebContents: host,
      getType: () => 'webview',
      session: {}
    }
    expect(() =>
      h.handlers.get('browser:attach')!({ sender: host }, 'session-a', 7, 99)
    ).toThrow('browser guest WebContents is unavailable')

    h.guest = {
      hostWebContents: host,
      getType: () => 'window',
      session: h.browserSession
    }
    expect(() =>
      h.handlers.get('browser:attach')!({ sender: host }, 'session-a', 7, 99)
    ).toThrow('browser guest WebContents is unavailable')
    expect(service.attach).not.toHaveBeenCalled()
  })

  it('rejects an unavailable webview guest', () => {
    const service = fakeService()
    registerBrowserIpc(service)

    expect(() =>
      h.handlers.get('browser:attach')!({ sender: sender() }, 'session-a', 7, 99)
    ).toThrow('browser guest WebContents is unavailable')
    expect(service.attach).not.toHaveBeenCalled()
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
    listener('session-a', { tabs: [] })
    expect(h.sent).toEqual([
      {
        channel: 'browser:state',
        payload: { sessionId: 'session-a', state: { tabs: [] } }
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
    listener('session-a', { tabs: [] })
    expect(h.sent).toEqual([])
  })

  it('removes the destroyed listener when broadcasting finds a dead renderer', () => {
    const service = fakeService()
    const webContents = sender(true)
    registerBrowserIpc(service)
    h.handlers.get('browser:getState')!({ sender: webContents }, 'session-a', 7)

    const listener = vi.mocked(service.bindChange).mock.calls[0][0]
    listener('session-a', { tabs: [] })

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
    listener('session-a', { tabs: [] })
    listener('session-a', { tabs: [] })

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
