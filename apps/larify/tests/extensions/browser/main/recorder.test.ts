import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
}))

import { Recorder } from "../../../../src/extensions/browser/main/recorder"

describe("Recorder guards", () => {
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

  it("destroy is a no-op when idle", () => {
    expect(() => new Recorder().destroy()).not.toThrow()
  })
})
