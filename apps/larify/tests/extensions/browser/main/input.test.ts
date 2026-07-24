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
  typeText,
} from "../../../../src/extensions/browser/main/input"
import { namedKeyInfo } from "../../../../src/extensions/browser/main/keymap"
import { parseKeyChord } from "../../../../src/extensions/browser/main/keymap"

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
  it("maps standalone modifier names to real CDP keys", async () => {
    const { send, sent } = captureSend()
    const { info, modifiers } = parseKeyChord("Ctrl")

    await keyDown(send as never, info, modifiers | 2)

    expect(sent[0]).toMatchObject({
      key: "Control",
      code: "ControlLeft",
      windowsVirtualKeyCode: 17,
      modifiers: 2,
    })
  })

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

describe("keyboard text events", () => {
  it("dispatches keyDown and keyUp for representable characters", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      return {}
    })

    await typeText(send as never, "a1A?!")

    expect(calls.map(({ method, params }) => [method, params.type, params.key])).toEqual([
      ["Input.dispatchKeyEvent", "keyDown", "a"],
      ["Input.dispatchKeyEvent", "keyUp", "a"],
      ["Input.dispatchKeyEvent", "keyDown", "1"],
      ["Input.dispatchKeyEvent", "keyUp", "1"],
      ["Input.dispatchKeyEvent", "keyDown", "A"],
      ["Input.dispatchKeyEvent", "keyUp", "A"],
      ["Input.dispatchKeyEvent", "keyDown", "?"],
      ["Input.dispatchKeyEvent", "keyUp", "?"],
      ["Input.dispatchKeyEvent", "keyDown", "!"],
      ["Input.dispatchKeyEvent", "keyUp", "!"],
    ])
    expect(calls.slice(4).every(({ params }) => params.modifiers === 8)).toBe(true)
  })

  it("preserves held modifiers and falls back to insertText for unicode", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      return {}
    })

    await typeText(send as never, "c中", 2)

    expect(calls[0]).toMatchObject({
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown", key: "c", modifiers: 2 },
    })
    expect(calls[0].params.text).toBeUndefined()
    expect(calls.at(-1)).toEqual({ method: "Input.insertText", params: { text: "中" } })
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
