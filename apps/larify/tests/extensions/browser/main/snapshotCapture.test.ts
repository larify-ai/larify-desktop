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
  it("uses one unique marker for scan, lookup, attribute parsing, and cleanup", async () => {
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
    let marker = ""
    const expressions: string[] = []
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate") {
        const expression = String(params?.expression)
        expressions.push(expression)
        const match = expression.match(/var marker = "(data-__larify_cursor_[a-f0-9]+)"/)
        if (match) marker = match[1]
        return (params as { returnByValue?: boolean })?.returnByValue ? { result: { value: hits } } : {}
      }
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } }
      if (method === "DOM.querySelectorAll") {
        expect(params?.selector).toBe(`[${marker}]`)
        return { nodeIds: [10, 11] }
      }
      if (method === "DOM.describeNode") {
        return (params as { nodeId?: number }).nodeId === 10
          ? { node: { backendNodeId: 100, attributes: [marker, "0", "type", "button"] } }
          : { node: { backendNodeId: 101, attributes: ["value", marker] } }
      }
      return {}
    })

    const map = await scanCursor(send as never)

    expect(map.size).toBe(1)
    expect(map.get(100)).toMatchObject({ kind: "clickable", text: "Go" })
    expect(map.has(101)).toBe(false)
    expect(expressions.at(-1)).toContain(`var marker="${marker}"`)
    expect(expressions.join("\n")).not.toContain("data-__ab-ci")
  })

  it("gives concurrent scans different markers", async () => {
    const selectors: string[] = []
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate") {
        return (params as { returnByValue?: boolean })?.returnByValue
          ? { result: { value: [{ text: "", hasOnClick: true }] } }
          : {}
      }
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } }
      if (method === "DOM.querySelectorAll") {
        selectors.push(String(params?.selector))
        return { nodeIds: [] }
      }
      return {}
    })

    await Promise.all([scanCursor(send as never), scanCursor(send as never)])

    expect(selectors).toHaveLength(2)
    expect(selectors[0]).not.toBe(selectors[1])
  })
})
