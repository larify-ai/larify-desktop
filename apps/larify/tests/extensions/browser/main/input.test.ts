import { describe, expect, it, vi } from "vitest"
import {
  boxModelCenter,
  dispatchClick,
  dispatchKey,
  keyDown,
  mouseDown,
  mouseMove,
  mouseUp,
  newMouseState,
} from "../../../../src/extensions/browser/main/input"
import { namedKeyInfo } from "../../../../src/extensions/browser/main/keymap"

describe("boxModelCenter", () => {
  it("averages the four content-quad corners", () => {
    expect(boxModelCenter({ content: [0, 0, 10, 0, 10, 20, 0, 20] })).toEqual({ x: 5, y: 10 })
  })

  it("falls back to the origin when the quad has fewer than 8 points", () => {
    expect(boxModelCenter({ content: [1, 2, 3, 4] })).toEqual({ x: 0, y: 0 })
    expect(boxModelCenter({})).toEqual({ x: 0, y: 0 })
  })
})

const keyA = { key: "a", code: "KeyA", keyCode: 65 }

function captureSend(): {
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>
  sent: Array<Record<string, unknown>>
} {
  const sent: Array<Record<string, unknown>> = []
  const send = vi.fn(async (_method: string, params: Record<string, unknown>) => {
    sent.push(params)
    return {}
  })
  return { send, sent }
}

describe("keyDown command-chord text suppression", () => {
  it("includes text for a plain key press", async () => {
    const { send, sent } = captureSend()
    await keyDown(send as never, keyA as never, 0)
    expect(sent[0].text).toBe("a")
  })

  it("omits text when a ctrl or meta modifier is held", async () => {
    const ctrl = captureSend()
    await keyDown(ctrl.send as never, keyA as never, 2)
    expect(ctrl.sent[0].text).toBeUndefined()

    const meta = captureSend()
    await keyDown(meta.send as never, keyA as never, 4)
    expect(meta.sent[0].text).toBeUndefined()
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

describe("one-shot input cleanup", () => {
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

  it("retries key release after keyUp fails and preserves the error", async () => {
    const types: string[] = []
    const send = vi.fn(async (_method: string, params: { type?: string }) => {
      types.push(params.type ?? "")
      if (params.type === "keyUp") throw new Error("key up failed")
      return {}
    })

    await expect(dispatchKey(send as never, namedKeyInfo("shift"))).rejects.toThrow(
      "key up failed",
    )
    expect(types.filter((type) => type === "keyUp")).toHaveLength(2)
  })
})
