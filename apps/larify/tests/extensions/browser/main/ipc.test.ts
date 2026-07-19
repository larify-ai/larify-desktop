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
import type { BrowserTabManager } from "../../../../src/extensions/browser/main/tab-manager"

function fakeManager(): BrowserTabManager & { bindChange: ReturnType<typeof vi.fn> } {
  return {
    bindChange: vi.fn(),
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
  } as unknown as BrowserTabManager & { bindChange: ReturnType<typeof vi.fn> }
}

describe("registerBrowserIpc", () => {
  beforeEach(() => {
    h.handlers.clear()
    h.sent.length = 0
  })

  it("registers every browser channel without creating the manager immediately", () => {
    const getManager = vi.fn(fakeManager)
    registerBrowserIpc(getManager)
    expect(getManager).not.toHaveBeenCalled()
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
    const manager = fakeManager()
    registerBrowserIpc(() => manager)
    h.handlers.get("browser:navigate")!({}, 3, "openai.com")
    expect(manager.navigate).toHaveBeenCalledWith(3, "openai.com")
    expect(h.handlers.get("browser:create")!({}, undefined)).toBe(7)
  })

  it("pushes state changes to renderer windows", () => {
    const manager = fakeManager()
    registerBrowserIpc(() => manager)
    h.handlers.get("browser:getState")!({})
    const onChange = manager.bindChange.mock.calls[0][0] as () => void
    onChange()
    expect(h.sent).toContainEqual({ channel: "browser:state", payload: { tabs: [], activeId: null } })
  })

  it("cleanup removes all handlers", () => {
    const dispose = registerBrowserIpc(fakeManager)
    dispose()
    expect(h.handlers.size).toBe(0)
  })
})
