import { describe, expect, it, vi } from "vitest"
import {
  captureSnapshot,
  resolveAxSession,
  scanCursor,
} from "../../../../src/extensions/browser/main/snapshotCapture"
import type { CdpSend } from "../../../../src/extensions/browser/main/snapshotCapture"

/**
 * `captureSnapshot({ selector })` now waits for the selector to be attached before its single
 * read (see memory/larify-desktop/snapshot-selector-race.md). That makes `waitForSelector` the
 * OUTERMOST call, so stubs must route by expression shape:
 *   - attached probe → `Runtime.evaluate` with `returnByValue: true`
 *   - business read  → `Runtime.evaluate` with `returnByValue: false`
 * Collapsing them (one stub for "any Runtime.evaluate") would make an `exceptionDetails` stub
 * fail inside the wait (EvaluationError is terminal) before the read's own error branch runs.
 */
const isAttachedProbe = (params?: Record<string, unknown>): boolean =>
  String(params?.expression).includes("!!document.querySelector")
const isBusinessRead = (params?: Record<string, unknown>): boolean =>
  !isAttachedProbe(params) && String(params?.expression).startsWith("document.querySelector")

/** Records the Runtime.evaluate call order so tests can assert `probe` before `read`. */
function traceEvaluate(params?: Record<string, unknown>): string {
  if (isAttachedProbe(params)) return "probe"
  if (isBusinessRead(params)) return "read"
  return "other"
}

/** A `captureSnapshot` send stub with per-kind overrides for the two Runtime.evaluate shapes. */
function captureSend(config: {
  /** Probe replies, taken in order; the last value repeats once exhausted. */
  probeValues?: boolean[]
  /** Reject the attached probe on its Nth call (1-based) to emulate a terminal CDP error. */
  failOnProbe?: { message: string; atProbe: number }
  /** Override the business-read reply (defaults to an `objectId`). */
  readResult?: unknown
}): { send: CdpSend; trace: string[] } {
  const trace: string[] = []
  let probeIndex = 0
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "Runtime.evaluate") {
      trace.push(traceEvaluate(params))
      if (isAttachedProbe(params)) {
        probeIndex += 1
        if (config.failOnProbe && probeIndex === config.failOnProbe.atProbe) {
          throw new Error(config.failOnProbe.message)
        }
        const values = config.probeValues ?? []
        const value = values.length === 0 ? true : values[Math.min(probeIndex - 1, values.length - 1)]
        return { result: { value } }
      }
      return config.readResult ?? { result: { objectId: "obj-1" } }
    }
    if (method === "DOM.describeNode") {
      return { node: { backendNodeId: 10, children: [{ backendNodeId: 10 }] } }
    }
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
          { nodeId: "2", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 10 },
        ],
      }
    }
    return {}
  })
  return { send: send as unknown as CdpSend, trace }
}

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

describe("captureSnapshot selector wait", () => {
  it("falls back to the original read and reports a missing element after the wait times out", async () => {
    // Probe never turns true; the read then returns no objectId, so the original
    // `matched no element` text/semantics are preserved after the ~5s fallback.
    const { send, trace } = captureSend({ probeValues: [false], readResult: { result: {} } })

    await expect(
      captureSnapshot(send, new Map(), 1, { selector: "#never" }),
    ).rejects.toThrow("selector '#never' matched no element")

    // The element never appears ⇒ the wait polls `attached` at least once, then the single
    // business read runs (product of the original fallback path).
    expect(trace[0]).toBe("probe")
    expect(trace).toContain("read")
    expect(trace.indexOf("probe")).toBeLessThan(trace.indexOf("read"))
  }, 10_000)

  it("resolves the element once it appears, and probes attached before reading", async () => {
    const { send, trace } = captureSend({ probeValues: [false, false, true] })

    await expect(
      captureSnapshot(send, new Map(), 1, { selector: "#late" }),
    ).resolves.toMatchObject({ text: expect.stringContaining('button "Go"') })

    // Wait-before-read: the last attached probe precedes the business read, and both happened.
    const lastProbe = trace.lastIndexOf("probe")
    expect(lastProbe).toBeGreaterThanOrEqual(0)
    expect(lastProbe).toBeLessThan(trace.indexOf("read"))
    expect(trace.filter((k) => k === "probe").length).toBeGreaterThanOrEqual(2)
  })

  it("aborts during the wait instead of swallowing it", async () => {
    const controller = new AbortController()
    const { send, trace } = captureSend({ probeValues: [false] })

    const pending = captureSnapshot(send, new Map(), 1, { selector: "#never" }, undefined, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()

    await expect(pending).rejects.toThrow("operation aborted")
    // The abort surfaced from the wait phase, so the business read never ran.
    expect(trace).not.toContain("read")
  })

  it("propagates a terminal error raised while waiting", async () => {
    const { send, trace } = captureSend({
      failOnProbe: { message: "tab was closed", atProbe: 1 },
    })

    await expect(
      captureSnapshot(send, new Map(), 1, { selector: "#gone" }),
    ).rejects.toThrow("tab was closed")
    // A terminal error is NOT the timeout fallback: it aborts the wait, so no read runs.
    expect(trace).not.toContain("read")
  })
})

describe("captureSnapshot selector errors", () => {
  it("reports malformed CSS as invalid instead of a missing element", async () => {
    // An invalid selector makes the read surface the parse error. The stub routes the attached
    // probe to a plain boolean (as `waits` expects) so the wait resolves; a single un-routed
    // "any Runtime.evaluate returns exceptionDetails" stub would instead throw EvaluationError
    // inside the wait (terminal, immediately propagated) before the read's `is invalid` runs.
    const { send } = captureSend({
      probeValues: [true],
      readResult: {
        result: {},
        exceptionDetails: { exception: { description: "SyntaxError: invalid selector" } },
      },
    })

    await expect(
      captureSnapshot(send, new Map(), 1, { selector: "input[" }),
    ).rejects.toThrow("selector 'input[' is invalid")
  })

  it("keeps the `is invalid` text for a malformed selector raised during the wait", async () => {
    // Regression guard: the attached probe evaluates the SAME selector as the read, so a
    // malformed selector makes Chromium raise its raw `SyntaxError` DURING the wait. This stub
    // answers every `Runtime.evaluate` with `exceptionDetails` (realistic for a bad selector), so
    // the wait itself is what fails — no `probeValues: [true]` crutch, which is what hid the bug.
    const send = vi.fn(async (method: string) =>
      method === "Runtime.evaluate"
        ? {
            exceptionDetails: {
              text: "Uncaught",
              exception: {
                description: "SyntaxError: Failed to execute 'querySelector' on 'Document'",
              },
            },
          }
        : {},
    ) as unknown as CdpSend

    await expect(captureSnapshot(send, new Map(), 1, { selector: "input[" })).rejects.toThrow(
      "selector 'input[' is invalid"
    )
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
