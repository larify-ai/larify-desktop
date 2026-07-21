import { describe, expect, it, vi } from "vitest"
import {
  boxModelCenter,
  keyDown,
  mouseDown,
  mouseUp,
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
})
