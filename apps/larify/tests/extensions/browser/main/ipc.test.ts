import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ sender: string; channel: string; payload: unknown }>,
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      if (h.handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`)
      h.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => h.handlers.delete(channel),
  },
}))

import { registerBrowserIpc } from "../../../../src/extensions/browser/main/ipc"
import type { BrowserService } from "../../../../src/extensions/browser/main/browser-service"

function sender(name: string, destroyed = false): {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
  once(event: string, listener: () => void): void
  off(event: string, listener: () => void): void
  emitDestroyed(): void
} {
  let onDestroyed: (() => void) | undefined
  return {
    isDestroyed: () => destroyed,
    send: (channel, payload) => h.sent.push({ sender: name, channel, payload }),
    once: (event, listener) => {
      if (event === "destroyed") onDestroyed = listener
    },
    off: (event, listener) => {
      if (event === "destroyed" && onDestroyed === listener) onDestroyed = undefined
    },
    emitDestroyed: () => onDestroyed?.(),
  }
}

const event = (name: string, destroyed = false): unknown => ({ sender: sender(name, destroyed) })

function fakeService(): BrowserService & { bindChange: ReturnType<typeof vi.fn> } {
  const unbindChange = vi.fn()
  return {
    bindChange: vi.fn(() => unbindChange),
    state: vi.fn(() => ({ tabs: [], activeId: null })),
    createTab: vi.fn(() => 7),
    ensureTab: vi.fn(() => 8),
    setActive: vi.fn(),
    reorder: vi.fn(),
    close: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    unbindChange,
  } as unknown as BrowserService & { bindChange: ReturnType<typeof vi.fn> }
}

describe("registerBrowserIpc", () => {
  beforeEach(() => {
    h.handlers.clear()
    h.sent.length = 0
  })

  it("registers every browser channel without creating the manager immediately", () => {
    const getService = vi.fn(fakeService)
    registerBrowserIpc(getService)
    expect(getService).not.toHaveBeenCalled()
    for (const name of [
      "getState",
      "create",
      "ensureTab",
      "setActive",
      "reorder",
      "close",
      "navigate",
      "back",
      "forward",
      "reload",
      "setBounds",
      "setVisible",
    ]) {
      expect(h.handlers.has(`browser:${name}`)).toBe(true)
    }
  })

  it("routes commands to the manager", () => {
    const service = fakeService()
    registerBrowserIpc(() => service)
    h.handlers.get("browser:navigate")!(event("main"), "session-a", 3, "openai.com")
    expect(service.navigate).toHaveBeenCalledWith("session-a", 3, "openai.com")
    expect(h.handlers.get("browser:create")!(event("main"), "session-a", undefined)).toBe(7)
    expect(h.handlers.get("browser:ensureTab")!(event("main"), "session-a")).toBe(8)
  })

  it("pushes state changes only to renderer webContents that subscribed through IPC", () => {
    const service = fakeService()
    registerBrowserIpc(() => service)
    h.handlers.get("browser:getState")!(event("renderer"), "session-a")
    const onChange = service.bindChange.mock.calls[0][0] as (
      sessionId: string,
      state: unknown,
    ) => void
    onChange("session-a", { tabs: [], activeId: null })
    expect(h.sent).toEqual([{
      sender: "renderer",
      channel: "browser:state",
      payload: { sessionId: "session-a", state: { tabs: [], activeId: null } },
    }])
  })

  it("drops destroyed subscribers without sending to them", () => {
    const service = fakeService()
    registerBrowserIpc(() => service)
    h.handlers.get("browser:getState")!(event("destroyed", true), "session-a")
    const onChange = service.bindChange.mock.calls[0][0] as (
      sessionId: string,
      state: unknown,
    ) => void

    onChange("session-a", { tabs: [], activeId: null })

    expect(h.sent).toEqual([])
  })

  it("drops a subscriber as soon as its webContents is destroyed", () => {
    const service = fakeService()
    registerBrowserIpc(() => service)
    const renderer = sender("renderer")
    h.handlers.get("browser:getState")!({ sender: renderer }, "session-a")
    renderer.emitDestroyed()
    const onChange = service.bindChange.mock.calls[0][0] as (
      sessionId: string,
      state: unknown,
    ) => void

    onChange("session-a", { tabs: [], activeId: null })

    expect(h.sent).toEqual([])
  })

  it("cleanup removes all handlers", () => {
    const service = fakeService()
    const dispose = registerBrowserIpc(() => service)
    h.handlers.get("browser:getState")!(event("main"), "session-a")
    dispose()
    expect((service as unknown as { unbindChange: ReturnType<typeof vi.fn> }).unbindChange)
      .toHaveBeenCalled()
    expect(h.handlers.size).toBe(0)
  })
})
