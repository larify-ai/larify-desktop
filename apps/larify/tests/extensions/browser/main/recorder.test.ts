import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    listeners,
    createdWindows: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
    failWindowLoad: false,
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
  BrowserWindow: class {
    destroy = vi.fn()
    webContents = {
      loadURL: vi.fn(async () => {
        if (h.failWindowLoad) throw new Error("recorder page failed to load")
      }),
    }
    constructor() {
      h.createdWindows.push(this)
    }
    setPosition(): void {}
    isDestroyed(): boolean {
      return false
    }
  },
  ipcMain: h.ipcMain,
}))

import { Recorder } from "../../../../src/extensions/browser/main/recorder"

describe("Recorder guards", () => {
  beforeEach(() => {
    h.listeners.clear()
    h.createdWindows.length = 0
    h.failWindowLoad = false
  })

  it("reports not recording before any start", () => {
    expect(new Recorder().isRecording()).toBe(false)
  })

  it("reports recording while start is still in progress", () => {
    const recorder = new Recorder()
    ;(recorder as unknown as { starting: boolean }).starting = true

    expect(recorder.isRecording()).toBe(true)
  })

  it("destroys a recorder window whose internal page fails to load", async () => {
    h.failWindowLoad = true
    const recorder = new Recorder()

    await expect(
      (
        recorder as unknown as {
          ensureWindow(): Promise<unknown>
        }
      ).ensureWindow(),
    ).rejects.toThrow("recorder page failed to load")

    expect(h.createdWindows).toHaveLength(1)
    expect(h.createdWindows[0].destroy).toHaveBeenCalledOnce()
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

  it("does not start a replacement recording after destroy begins", async () => {
    const recorder = new Recorder()
    let finishStopping!: () => void
    const stopping = new Promise<{ path: string; bytes: number }>((resolve) => {
      finishStopping = () => resolve({ path: "old.webm", bytes: 1 })
    })
    const destroyWindow = vi.fn()
    ;(recorder as unknown as { stopping: unknown; win: unknown }).stopping = stopping
    ;(recorder as unknown as { stopping: unknown; win: unknown }).win = {
      isDestroyed: () => false,
      destroy: destroyWindow,
    }
    const start = vi.spyOn(recorder, "start")

    const restarting = recorder.restart({} as never, "new.webm")
    const restartAssertion = expect(restarting).rejects.toThrow("recorder is destroyed")
    const destroying = recorder.destroy()
    finishStopping()

    await expect(destroying).resolves.toBeUndefined()
    await restartAssertion
    expect(start).not.toHaveBeenCalled()
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

  it("fails promptly when the recorder window is destroyed while stopping", async () => {
    const recorder = new Recorder()
    const listeners = new Map<string, Set<() => void>>()
    const sender = {
      send: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        const eventListeners = listeners.get(event) ?? new Set()
        eventListeners.add(listener)
        listeners.set(event, eventListeners)
      }),
      off: vi.fn((event: string, listener: () => void) => {
        listeners.get(event)?.delete(listener)
      }),
      emit(event: string): void {
        for (const listener of listeners.get(event) ?? []) listener()
      },
    }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "out.webm",
      tabId: 1,
      generation: 1,
      frameCount: () => 7,
    }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: sender,
    }

    const stopping = recorder.stop()
    await vi.waitFor(() => expect(sender.once).toHaveBeenCalledWith("destroyed", expect.any(Function)))
    sender.emit("destroyed")
    const outcome = await Promise.race([
      stopping.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 20)),
    ])

    expect(outcome).toBe("rejected")
    await expect(stopping).rejects.toThrow("recorder window was destroyed")
  })

  it("cleans up IPC listeners when sending the stop message throws", async () => {
    const recorder = new Recorder()
    const sender = {
      send: vi.fn(() => {
        throw new Error("send failed")
      }),
    }
    const dbg = { sendCommand: vi.fn(async () => ({})), off: vi.fn() }
    ;(recorder as unknown as { active: unknown }).active = {
      dbg,
      onMessage: () => {},
      path: "out.webm",
      tabId: 1,
      generation: 1,
      frameCount: () => 7,
    }
    ;(recorder as unknown as { win: unknown }).win = {
      isDestroyed: () => false,
      destroy: vi.fn(),
      webContents: sender,
    }

    await expect(recorder.stop()).rejects.toThrow("send failed")
    expect(h.listeners.get("record:done")?.size ?? 0).toBe(0)
  })
})
