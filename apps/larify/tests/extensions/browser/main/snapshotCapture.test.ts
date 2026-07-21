import { describe, expect, it, vi } from "vitest"
import { resolveAxSession, scanCursor } from "../../../../src/extensions/browser/main/snapshotCapture"

describe("resolveAxSession", () => {
  it("returns bare params for the top frame", () => {
    expect(resolveAxSession(undefined)).toEqual({ params: {} })
  })

  it("returns the OOPIF session when the frame has one", () => {
    expect(resolveAxSession("F1", new Map([["F1", "SID"]]))).toEqual({ params: {}, sessionId: "SID" })
  })

  it("threads the frameId as a param for same-process frames", () => {
    expect(resolveAxSession("F2", new Map())).toEqual({ params: { frameId: "F2" } })
  })
})

describe("scanCursor", () => {
  it("maps hits by backendNodeId and skips markers found at an odd attribute index", async () => {
    const hits = [
      {
        text: "Go",
        hasOnClick: true,
        hasCursorPointer: false,
        hasTabIndex: false,
        isEditable: false,
        hiddenInputType: null,
        hiddenInputChecked: null,
      },
    ]
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate") {
        return (params as { returnByValue?: boolean })?.returnByValue ? { result: { value: hits } } : {}
      }
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } }
      if (method === "DOM.querySelectorAll") return { nodeIds: [10, 11] }
      if (method === "DOM.describeNode") {
        return (params as { nodeId?: number }).nodeId === 10
          ? { node: { backendNodeId: 100, attributes: ["data-__ab-ci", "0", "type", "button"] } }
          : { node: { backendNodeId: 101, attributes: ["value", "data-__ab-ci"] } }
      }
      return {}
    })

    const map = await scanCursor(send as never)

    expect(map.size).toBe(1)
    expect(map.get(100)).toMatchObject({ kind: "clickable", text: "Go" })
    expect(map.has(101)).toBe(false)
  })
})
