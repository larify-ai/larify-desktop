import { describe, expect, it, vi } from "vitest"
import {
  boxModelCenter,
  dispatchClick,
  mouseDown,
  mouseMove,
  mouseUp,
  mouseWheel,
  newMouseState,
} from "../../../../src/extensions/browser/main/input"

describe("boxModelCenter", () => {
  it("averages the four content-quad corners", () => {
    expect(boxModelCenter({ content: [0, 0, 10, 0, 10, 20, 0, 20] })).toEqual({ x: 5, y: 10 })
  })

  it("falls back to the origin when the quad has fewer than 8 points", () => {
    expect(boxModelCenter({ content: [1, 2, 3, 4] })).toEqual({ x: 0, y: 0 })
    expect(boxModelCenter({})).toEqual({ x: 0, y: 0 })
  })
})

describe("mouse buttons bitmask state machine", () => {
  it("accumulates and clears button bits across down and up", async () => {
    const seen: number[] = []
    const send = vi.fn(async (_method: string, params: { buttons?: number }) => {
      seen.push(params.buttons ?? -1)
      return {}
    })
    const state = newMouseState()

    await mouseDown(send as never, state, "left")
    await mouseDown(send as never, state, "right")
    await mouseUp(send as never, state, "left")

    expect(seen).toEqual([1, 3, 2])
    expect(state.buttons).toBe(2)
  })

  it("rolls back a button press when CDP rejects it", async () => {
    const state = newMouseState()
    const send = vi.fn(async () => {
      throw new Error("CDP unavailable")
    })

    await expect(mouseDown(send as never, state, "left")).rejects.toThrow("CDP unavailable")
    expect(state.buttons).toBe(0)
  })

  it("keeps a button pressed when CDP rejects its release", async () => {
    const state = newMouseState()
    state.buttons = 1
    const send = vi.fn(async () => {
      throw new Error("CDP unavailable")
    })

    await expect(mouseUp(send as never, state, "left")).rejects.toThrow("CDP unavailable")
    expect(state.buttons).toBe(1)
  })

  it("commits pointer coordinates only after CDP accepts the movement", async () => {
    const state = newMouseState()
    const send = vi.fn().mockRejectedValue(new Error("move failed"))

    await expect(mouseMove(send as never, state, 50, 60)).rejects.toThrow("move failed")
    expect(state).toEqual({ x: 0, y: 0, buttons: 0 })
  })
})

describe("mouse wheel completion", () => {
  it("waits for the renderer task queue and preserves held buttons", async () => {
    const send = vi.fn(async () => ({}))
    const state = newMouseState()
    state.buttons = 1

    await mouseWheel(send as never, state, 0, 500)

    expect(send).toHaveBeenNthCalledWith(
      1,
      "Input.dispatchMouseEvent",
      { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY: 500, buttons: 1 },
      undefined,
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      "Runtime.evaluate",
      {
        expression:
          "new Promise(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); })",
        awaitPromise: true,
      },
      undefined,
    )
  })

  it("omits an empty buttons field so Chromium performs default scrolling", async () => {
    const send = vi.fn(async () => ({}))

    await mouseWheel(send as never, newMouseState(), 0, 500)

    expect(send).toHaveBeenNthCalledWith(
      1,
      "Input.dispatchMouseEvent",
      { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY: 500 },
      undefined,
    )
  })
})

describe("one-shot input cleanup", () => {
  it("attempts mouse release when the press command fails", async () => {
    const types: string[] = []
    const send = vi.fn(async (_method: string, params: { type?: string }) => {
      types.push(params.type ?? "")
      if (params.type === "mousePressed") throw new Error("press failed")
      return {}
    })

    await expect(dispatchClick(send as never, 10, 20)).rejects.toThrow("press failed")
    expect(types).toEqual(["mouseMoved", "mousePressed", "mouseReleased"])
  })

  it("retries mouse release after a post-press release failure and preserves the error", async () => {
    const types: string[] = []
    const send = vi.fn(async (_method: string, params: { type?: string }) => {
      types.push(params.type ?? "")
      if (params.type === "mouseReleased") throw new Error("release failed")
      return {}
    })

    await expect(dispatchClick(send as never, 10, 20)).rejects.toThrow("release failed")
    expect(types.filter((type) => type === "mouseReleased")).toHaveLength(2)
  })

})
