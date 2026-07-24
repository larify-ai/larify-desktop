import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    listeners,
    ipcMain: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const channelListeners = listeners.get(channel) ?? new Set()
        channelListeners.add(listener)
        listeners.set(channel, channelListeners)
      }),
      removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(listener)
      }),
    },
    emit(channel: string, ...args: unknown[]): void {
      for (const listener of listeners.get(channel) ?? []) listener(...args)
    },
  }
})

vi.mock("electron", () => ({
  BrowserWindow: class {},
  ipcMain: h.ipcMain,
}))

import { Recorder } from "../../../../src/extensions/browser/main/recorder"

describe("Recorder guards", () => {
  beforeEach(() => {
    h.listeners.clear()
  })

  it("reports not recording before any start", () => {
    expect(new Recorder().isRecording()).toBe(false)
  })

  it("rejects stop when there is no active recording", async () => {
    await expect(new Recorder().stop()).rejects.toThrow("no recording in progress")
  })

  it("rejects start when a recording is already active", async () => {
    const recorder = new Recorder()
    ;(recorder as unknown as { active: unknown }).active = { dbg: {}, onMessage: () => {}, path: "x" }

    await expect(recorder.start({} as never, "out.webm")).rejects.toThrow("already in progress")
  })

  it("destroy is a no-op when idle", async () => {
    await expect(new Recorder().destroy()).resolves.toBeUndefined()
  })

  it("finalizes an active recording before destroying its window", async () => {
    const recorder = new Recorder()
    const destroy = vi.fn()
    const sender = {
      send: vi.fn((channel: string) => {
        if (channel === "record:stop") queueMicrotask(() => h.emit("record:done", { sender }, { bytes: 10 }))
      }),
    }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { active: unknown }).active = { dbg, onMessage: () => {}, path: "out.webm" }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy,
      webContents: sender,
    }

    await recorder.destroy()

    expect(sender.send).toHaveBeenCalledWith("record:stop")
    expect(dbg.sendCommand).toHaveBeenCalledWith("Page.stopScreencast")
    expect(destroy).toHaveBeenCalledOnce()
  })

  it("rejects an empty recording instead of reporting success", async () => {
    const recorder = new Recorder()
    const sender = {
      send: vi.fn((channel: string) => {
        if (channel === "record:stop") queueMicrotask(() => h.emit("record:done", { sender }, { bytes: 0 }))
      }),
    }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { active: unknown }).active = { dbg, onMessage: () => {}, path: "out.webm" }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: sender,
    }

    await expect(recorder.stop()).rejects.toThrow("recorder produced an empty file")
  })
})
