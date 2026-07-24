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

  it("reports recording while start is still in progress", () => {
    const recorder = new Recorder()
    ;(recorder as unknown as { starting: boolean }).starting = true

    expect(recorder.isRecording()).toBe(true)
  })

  it("rejects stop when there is no active recording", async () => {
    await expect(new Recorder().stop()).rejects.toThrow("no recording in progress")
  })

  it("rejects start when a recording is already active", async () => {
    const recorder = new Recorder()
    ;(recorder as unknown as { active: unknown }).active = {
      dbg: { off: vi.fn(), sendCommand: vi.fn(async () => ({})) },
      onMessage: () => {},
      path: "x",
    }
    ;(recorder as unknown as { win: unknown }).win = { isDestroyed: () => false }

    await expect(recorder.start({} as never, "out.webm")).rejects.toThrow("already in progress")
  })

  it("rejects a second start while the first is still in progress", async () => {
    const recorder = new Recorder()
    ;(recorder as unknown as { starting: boolean }).starting = true

    await expect(recorder.start({} as never, "out.webm")).rejects.toThrow("already in progress")
  })

  it("waits for an in-progress start before stopping the resulting recording", async () => {
    const recorder = new Recorder()
    let finishStart!: () => void
    const startDone = new Promise<void>((resolve) => {
      finishStart = resolve
    })
    ;(recorder as unknown as { startDone: Promise<void> }).startDone = startDone
    const sender = {
      send: vi.fn((channel: string) => {
        if (channel === "record:stop") queueMicrotask(() => h.emit("record:done", { sender }, { bytes: 10 }))
      }),
    }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: sender,
    }

    const stopping = recorder.stop()
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "out.webm",
      frameCount: () => 7,
    }
    finishStart()

    await expect(stopping).resolves.toEqual({ path: "out.webm", bytes: 10 })
  })

  it("rejects start while a previous recording is still stopping", async () => {
    const recorder = new Recorder()
    const sender = { send: vi.fn() }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "old.webm",
      frameCount: () => 7,
    }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: sender,
    }

    const stopping = recorder.stop()
    await Promise.resolve()
    await expect(recorder.start({} as never, "new.webm")).rejects.toThrow("already in progress")
    h.emit("record:done", { sender }, { bytes: 10 })
    await stopping
  })

  it("destroy is a no-op when idle", async () => {
    await expect(new Recorder().destroy()).resolves.toBeUndefined()
  })

  it("waits for an in-progress start before destroying the resulting recording", async () => {
    const recorder = new Recorder()
    let finishStart!: () => void
    const startDone = new Promise<void>((resolve) => {
      finishStart = resolve
    })
    ;(recorder as unknown as { startDone: Promise<void> }).startDone = startDone
    const destroyWindow = vi.fn()
    const sender = {
      send: vi.fn((channel: string) => {
        if (channel === "record:stop") queueMicrotask(() => h.emit("record:done", { sender }, { bytes: 10 }))
      }),
    }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: destroyWindow,
      webContents: sender,
    }

    const destroying = recorder.destroy()
    let settled = false
    void destroying.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "out.webm",
      frameCount: () => 7,
    }
    finishStart()
    await destroying

    expect(sender.send).toHaveBeenCalledWith("record:stop")
    expect(destroyWindow).toHaveBeenCalledOnce()
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
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "out.webm",
      frameCount: () => 7,
    }
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
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "out.webm",
      frameCount: () => 7,
    }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: sender,
    }

    await expect(recorder.stop()).rejects.toThrow("recorder produced an empty file after 7 frames")
  })

  it("rejects a recording whose output stream failed", async () => {
    const recorder = new Recorder()
    const sender = {
      send: vi.fn((channel: string) => {
        if (channel === "record:stop") {
          queueMicrotask(() => h.emit("record:done", { sender }, { bytes: 0, error: "disk full" }))
        }
      }),
    }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "out.webm",
      frameCount: () => 7,
    }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: sender,
    }

    await expect(recorder.stop()).rejects.toThrow("recorder failed to write output: disk full")
  })

  it("drops stale recording state when the recorder window has crashed", async () => {
    const recorder = new Recorder()
    const onMessage = vi.fn()
    const dbg = {
      sendCommand: vi.fn(async () => ({})),
      off: vi.fn(),
    }
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage,
      path: "crashed.webm",
      tabId: 1,
      generation: 1,
      frameCount: () => 7,
    }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => true,
      webContents: {},
    }

    expect(recorder.isRecording()).toBe(false)
    expect(dbg.off).toHaveBeenCalledWith("message", onMessage)
    expect(dbg.sendCommand).toHaveBeenCalledWith("Page.stopScreencast")
    await expect(recorder.stop()).rejects.toThrow("no recording in progress")
  })

  it("allows a recorded tab to close after the recorder window has crashed", async () => {
    const recorder = new Recorder()
    const onMessage = vi.fn()
    const dbg = {
      sendCommand: vi.fn(async () => ({})),
      off: vi.fn(),
    }
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage,
      path: "crashed.webm",
      tabId: 7,
      generation: 1,
      frameCount: () => 7,
    }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => true,
      webContents: {},
    }

    await expect(recorder.stopIfRecordingTab(7)).resolves.toBeUndefined()
    expect(recorder.isRecording()).toBe(false)
  })
})
