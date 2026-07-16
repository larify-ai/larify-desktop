import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionTerminalsState, TerminalCreateOptions } from "../../../../src/extensions/terminal/shared/types"

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const sends: Array<{ channel: string; payload: unknown }> = []
  const window = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn((channel: string, payload: unknown) => sends.push({ channel, payload })),
    },
  }
  return {
    handlers,
    sends,
    window,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      }),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => [window]),
    },
  }
})

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain,
}))

async function importIpc() {
  return import("../../../../src/extensions/terminal/main/ipc")
}

class FakeTerminalService {
  create = vi.fn((_sessionId: string, _opts?: TerminalCreateOptions) => 7)
  write = vi.fn()
  resize = vi.fn()
  close = vi.fn()
  setActive = vi.fn()
  reorder = vi.fn()
  snapshot = vi.fn(async () => ({ data: "snapshot", cols: 80, rows: 24 }))
  state = vi.fn((sessionId: string): SessionTerminalsState => ({ sessionId, terminals: [], activeId: null }))
  destroySession = vi.fn()
  unbindChange = vi.fn()
  unbindData = vi.fn()
  unbindExit = vi.fn()
  private changeCallback?: (state: SessionTerminalsState) => void
  private dataCallback?: (sessionId: string, terminalId: number, data: string) => void
  private exitCallback?: (sessionId: string, terminalId: number, exitCode: number) => void

  bindChange(callback: (state: SessionTerminalsState) => void): () => void {
    this.changeCallback = callback
    return this.unbindChange
  }

  bindData(callback: (sessionId: string, terminalId: number, data: string) => void): () => void {
    this.dataCallback = callback
    return this.unbindData
  }

  bindExit(callback: (sessionId: string, terminalId: number, exitCode: number) => void): () => void {
    this.exitCallback = callback
    return this.unbindExit
  }

  emitChange(state: SessionTerminalsState): void {
    this.changeCallback?.(state)
  }

  emitData(sessionId: string, terminalId: number, data: string): void {
    this.dataCallback?.(sessionId, terminalId, data)
  }

  emitExit(sessionId: string, terminalId: number, exitCode: number): void {
    this.exitCallback?.(sessionId, terminalId, exitCode)
  }
}

beforeEach(() => {
  vi.useRealTimers()
  electronMock.handlers.clear()
  electronMock.sends.length = 0
  electronMock.ipcMain.handle.mockClear()
  electronMock.ipcMain.removeHandler.mockClear()
  electronMock.BrowserWindow.getAllWindows.mockClear()
  electronMock.window.isDestroyed.mockClear()
  electronMock.window.webContents.send.mockClear()
})

describe("registerTerminalIpc", () => {
  it("registers terminal command handlers and forwards them to the service", async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()

    registerTerminalIpc(service as never)

    expect(electronMock.ipcMain.handle).toHaveBeenCalledTimes(9)
    expect(electronMock.handlers.get("terminal:create")?.({}, "session-1", { title: "Shell" })).toBe(7)
    expect(electronMock.handlers.get("terminal:getState")?.({}, "session-1")).toEqual({
      sessionId: "session-1",
      terminals: [],
      activeId: null,
    })
    electronMock.handlers.get("terminal:write")?.({}, "session-1", 7, "echo hi\r")
    electronMock.handlers.get("terminal:resize")?.({}, "session-1", 7, 120, 30)
    electronMock.handlers.get("terminal:setActive")?.({}, "session-1", 7)
    electronMock.handlers.get("terminal:reorder")?.({}, "session-1", 7, 0)
    await expect(electronMock.handlers.get("terminal:snapshot")?.({}, "session-1", 7)).resolves.toEqual({
      data: "snapshot",
      cols: 80,
      rows: 24,
    })
    electronMock.handlers.get("terminal:destroySession")?.({}, "session-1")

    expect(service.create).toHaveBeenCalledWith("session-1", { title: "Shell" })
    expect(service.write).toHaveBeenCalledWith("session-1", 7, "echo hi\r")
    expect(service.resize).toHaveBeenCalledWith("session-1", 7, 120, 30)
    expect(service.setActive).toHaveBeenCalledWith("session-1", 7)
    expect(service.reorder).toHaveBeenCalledWith("session-1", 7, 0)
    expect(service.snapshot).toHaveBeenCalledWith("session-1", 7)
    expect(service.destroySession).toHaveBeenCalledWith("session-1")
  })

  it("sends state events to renderer windows", async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never)

    service.emitChange({ sessionId: "session-1", terminals: [], activeId: null })

    expect(electronMock.sends).toEqual([
      { channel: "terminal:state", payload: { sessionId: "session-1", terminals: [], activeId: null } },
    ])
  })

  it("batches data events before sending them to the renderer", async () => {
    vi.useFakeTimers()
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never)

    service.emitData("session-1", 7, "a")
    service.emitData("session-1", 7, "b", 1, 2)
    expect(electronMock.sends).toEqual([])

    vi.advanceTimersByTime(10)

    expect(electronMock.sends).toEqual([
      { channel: "terminal:data", payload: { sessionId: "session-1", terminalId: 7, data: "ab" } },
    ])
    vi.useRealTimers()
  })

  it("flushes pending data before exit and close events", async () => {
    vi.useFakeTimers()
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never)

    service.emitData("session-1", 7, "pending")
    service.emitExit("session-1", 7, 0)

    expect(electronMock.sends).toEqual([
      { channel: "terminal:data", payload: { sessionId: "session-1", terminalId: 7, data: "pending" } },
      { channel: "terminal:exit", payload: { sessionId: "session-1", terminalId: 7, exitCode: 0 } },
    ])

    service.emitData("session-1", 7, "closing")
    electronMock.handlers.get("terminal:close")?.({}, "session-1", 7)

    expect(electronMock.sends.at(-1)).toEqual({
      channel: "terminal:data",
      payload: { sessionId: "session-1", terminalId: 7, data: "closing" },
    })
    expect(service.close).toHaveBeenCalledWith("session-1", 7)
    vi.useRealTimers()
  })

  it("unbinds service listeners and removes handlers on dispose", async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    const dispose = registerTerminalIpc(service as never)

    dispose()

    expect(service.unbindChange).toHaveBeenCalled()
    expect(service.unbindData).toHaveBeenCalled()
    expect(service.unbindExit).toHaveBeenCalled()
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledTimes(9)
    expect(electronMock.handlers.size).toBe(0)
  })
})
