import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }),
        },
      },
    ],
  },
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

function fakeService(): BrowserService & { bindChange: ReturnType<typeof vi.fn> } {
  const unbindChange = vi.fn()
  return {
    bindChange: vi.fn(() => unbindChange),
    state: vi.fn(() => ({ tabs: [], activeId: null })),
    createTab: vi.fn(() => 7),
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
    h.handlers.get("browser:navigate")!({}, "session-a", 3, "openai.com")
    expect(service.navigate).toHaveBeenCalledWith("session-a", 3, "openai.com")
    expect(h.handlers.get("browser:create")!({}, "session-a", undefined)).toBe(7)
  })

  it("pushes state changes to renderer windows", () => {
    const service = fakeService()
    registerBrowserIpc(() => service)
    h.handlers.get("browser:getState")!({}, "session-a")
    const onChange = service.bindChange.mock.calls[0][0] as (
      sessionId: string,
      state: unknown,
    ) => void
    onChange("session-a", { tabs: [], activeId: null })
    expect(h.sent).toContainEqual({
      channel: "browser:state",
      payload: { sessionId: "session-a", state: { tabs: [], activeId: null } },
    })
  })

  it("cleanup removes all handlers", () => {
    const service = fakeService()
    const dispose = registerBrowserIpc(() => service)
    h.handlers.get("browser:getState")!({}, "session-a")
    dispose()
    expect((service as unknown as { unbindChange: ReturnType<typeof vi.fn> }).unbindChange)
      .toHaveBeenCalled()
    expect(h.handlers.size).toBe(0)
  })
})
