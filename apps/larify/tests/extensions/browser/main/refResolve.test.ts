import { describe, expect, it, vi } from "vitest"
import {
  parseRef,
  resolveRefToBox,
  resolveRefToObjectId,
} from "../../../../src/extensions/browser/main/refResolve"
import type { CdpSend } from "../../../../src/extensions/browser/main/snapshotCapture"

/**
 * `resolveRefToBox` / `resolveRefToObjectId`'s `{selector}` branches now wait for the element to be
 * attached before their single read (see memory/larify-desktop/refresolve-wait-scope-decision.md).
 * That makes the wait the OUTERMOST `Runtime.evaluate`, so stubs must route by expression shape:
 *   - attached probe → boolean expression (`!!document.querySelector` for CSS, `document.evaluate`
 *     for `xpath=`), always `returnByValue: true`
 *   - business read  → the raw `document.querySelector(...)` / `document.evaluate(...)` expression
 * Collapsing them (one stub for "any Runtime.evaluate") would make an `exceptionDetails` stub fail
 * inside the wait (EvaluationError is terminal) before the read's own error branch runs.
 */
const isAttachedProbe = (params?: Record<string, unknown>): boolean => {
  const expr = String(params?.expression)
  return expr.startsWith("!!(") && params?.returnByValue === true
}
const isBusinessRead = (params?: Record<string, unknown>): boolean =>
  !isAttachedProbe(params) && String(params?.expression).startsWith("document.")

/** Records the `Runtime.evaluate` call order so tests can assert `probe` before `read`. */
function traceEvaluate(params?: Record<string, unknown>): string {
  if (isAttachedProbe(params)) return "probe"
  if (isBusinessRead(params)) return "read"
  return "other"
}

/** A send stub with per-kind overrides for the two `Runtime.evaluate` shapes. */
function makeSend(config: {
  /** Probe replies, taken in order; the last value repeats once exhausted. */
  probeValues?: boolean[]
  /** Reject the probe on its Nth call (1-based) to emulate a terminal CDP error. */
  failOnProbe?: { message: string; atProbe: number }
  /** Override the business-read reply (defaults to an `objectId`). */
  readResult?: unknown
}): { send: CdpSend; trace: string[]; probes: string[] } {
  const trace: string[] = []
  const probes: string[] = []
  let probeIndex = 0
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "Runtime.evaluate") {
      trace.push(traceEvaluate(params))
      if (isAttachedProbe(params)) {
        probes.push(String(params?.expression))
        probeIndex += 1
        if (config.failOnProbe && probeIndex === config.failOnProbe.atProbe) {
          throw new Error(config.failOnProbe.message)
        }
        const values = config.probeValues ?? []
        const value =
          values.length === 0 ? true : values[Math.min(probeIndex - 1, values.length - 1)]
        return { result: { value } }
      }
      return config.readResult ?? { result: { objectId: "OID" } }
    }
    return {}
  })
  return { send: send as unknown as CdpSend, trace, probes }
}

describe("parseRef", () => {
  it("accepts ref tokens and rejects selectors", () => {
    expect(parseRef("@e123")).toBe("e123")
    expect(parseRef("ref=e5")).toBe("e5")
    expect(parseRef("[ref=e181]")).toBe("e181")
    expect(parseRef("e12")).toBe("e12")
    expect(parseRef("  @e7  ")).toBe("e7")
  })

  it("keeps the @e / bare-e asymmetry and treats css as a selector", () => {
    expect(parseRef("@e")).toBe("e")
    expect(parseRef("e")).toBeUndefined()
    expect(parseRef("button")).toBeUndefined()
    expect(parseRef("input[name=q]")).toBeUndefined()
    expect(parseRef("ref=x1")).toBeUndefined()
  })
})

describe("resolveRefToObjectId selector wait", () => {
  it("waits for the element to appear and probes before reading", async () => {
    const { send, trace } = makeSend({ probeValues: [false, false, true] })
    await expect(resolveRefToObjectId(send, new Map(), "#late")).resolves.toEqual({ objectId: "OID" })

    // The element was probed at least twice, all before the single business read.
    expect(trace.filter((k) => k === "probe").length).toBeGreaterThanOrEqual(2)
    expect(trace.lastIndexOf("probe")).toBeLessThan(trace.indexOf("read"))
  })

  it("falls back to the original read and reports a missing element after the wait times out", async () => {
    // The probe never turns true; the read then returns no objectId, so the original
    // `matched no element` text/semantics are preserved after the ~5s fallback.
    const { send, trace } = makeSend({ probeValues: [false], readResult: { result: {} } })
    await expect(resolveRefToObjectId(send, new Map(), ".missing")).rejects.toThrow(
      "selector '.missing' matched no element",
    )
    expect(trace[0]).toBe("probe")
    expect(trace.indexOf("probe")).toBeLessThan(trace.indexOf("read"))
  }, 10_000)

  it("keeps xpath selectors working by probing with document.evaluate (no SyntaxError)", async () => {
    const { send, probes } = makeSend({ probeValues: [true] })
    await expect(resolveRefToObjectId(send, new Map(), "xpath=//button")).resolves.toEqual({
      objectId: "OID",
    })
    // The wait must use document.evaluate for xpath, not document.querySelector.
    expect(probes[0]).toContain("document.evaluate")
    expect(probes[0]).not.toContain("querySelector")
  })

  it("returns the objectId for a matching selector", async () => {
    const { send } = makeSend({})
    await expect(resolveRefToObjectId(send, new Map(), "button")).resolves.toEqual({
      objectId: "OID",
    })
  })

  it("throws for a malformed selector even when the exception object carries an objectId", async () => {
    // The attached probe must resolve as a plain boolean (as `waits` expects); only the business
    // read carries the parse error. A single un-routed stub would throw inside the wait instead.
    const { send } = makeSend({
      probeValues: [true],
      readResult: {
        result: { objectId: "EXCEPTION_OBJECT" },
        exceptionDetails: { text: "SyntaxError: bad selector" },
      },
    })
    await expect(resolveRefToObjectId(send, new Map(), "input[name=q")).rejects.toThrow(
      "selector 'input[name=q' is invalid",
    )
  })

  it("propagates a terminal error raised while waiting instead of swallowing it", async () => {
    const { send, trace } = makeSend({
      failOnProbe: { message: "tab was closed", atProbe: 1 },
    })
    await expect(resolveRefToObjectId(send, new Map(), "#gone")).rejects.toThrow("tab was closed")
    // A terminal error is NOT the timeout fallback: no business read runs.
    expect(trace).not.toContain("read")
  })

  // Regression guard: the wait probes with the SAME selector the read uses, so Chromium raises its
  // raw `SyntaxError` DURING the wait. Letting that through would replace the model-facing
  // `selector '…' is invalid` with Chromium's message. The stub below answers every
  // `Runtime.evaluate` with `exceptionDetails` — realistic for a malformed selector — and needs no
  // `probeValues: [true]` crutch, which is exactly what made the original bug invisible.
  const malformedSelectorSend = (): CdpSend =>
    vi.fn(async (method: string) =>
      method === "Runtime.evaluate"
        ? {
            exceptionDetails: {
              text: "Uncaught",
              exception: {
                description:
                  "SyntaxError: Failed to execute 'querySelector' on 'Document'",
              },
            },
          }
        : {},
    ) as unknown as CdpSend

  it("reports a malformed selector as invalid without leaking Chromium's SyntaxError", async () => {
    await expect(resolveRefToObjectId(malformedSelectorSend(), new Map(), "input[")).rejects.toThrow(
      "selector 'input[' is invalid",
    )
  })

  it("reports a malformed selector as invalid on the box path too", async () => {
    await expect(resolveRefToBox(malformedSelectorSend(), new Map(), "input[")).rejects.toThrow(
      "selector 'input[' is invalid",
    )
  })
})

describe("resolveRefToBox selector path", () => {
  it("reports a malformed selector as invalid instead of missing", async () => {
    const { send } = makeSend({
      probeValues: [true],
      readResult: {
        result: {},
        exceptionDetails: { text: "SyntaxError: bad selector" },
      },
    })

    await expect(resolveRefToBox(send, new Map(), "input[")).rejects.toThrow(
      "selector 'input[' is invalid",
    )
  })
})

describe("resolveRefToObjectId ref path", () => {
  it("preserves the frameId and OOPIF sessionId", async () => {
    const send = vi.fn(async (method: string) =>
      method === "Runtime.callFunctionOn"
        ? { result: { value: true } }
        : { object: { objectId: "OID" } },
    )
    const refs = new Map([
      [
        "e1",
        {
          backendNodeId: 7,
          frameId: "FRAME",
          role: "button",
          name: "Target",
        },
      ],
    ])

    await expect(
      resolveRefToObjectId(send as never, refs, "@e1", new Map([["FRAME", "OOPIF"]])),
    ).resolves.toEqual({
      objectId: "OID",
      frameId: "FRAME",
      sessionId: "OOPIF",
    })
  })

  it("re-anchors a ref whose resolved object is detached from the document", async () => {
    const ax = (value: string): { value: string } => ({ value })
    const send = vi.fn(async (method: string, params: { backendNodeId?: number }) => {
      if (method === "DOM.resolveNode") {
        return {
          object: {
            objectId: params.backendNodeId === 7 ? "DETACHED" : "FRESH",
          },
        }
      }
      if (method === "Runtime.callFunctionOn") return { result: { value: false } }
      if (method === "Runtime.evaluate") return { result: { value: [] } }
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              nodeId: "1",
              ignored: false,
              role: ax("RootWebArea"),
              name: ax(""),
              childIds: ["2"],
            },
            {
              nodeId: "2",
              ignored: false,
              role: ax("button"),
              name: ax("Target"),
              backendDOMNodeId: 9,
            },
          ],
        }
      }
      return {}
    })
    const refs = new Map([
      [
        "e1",
        {
          backendNodeId: 7,
          role: "button",
          name: "Target",
        },
      ],
    ])

    await expect(resolveRefToObjectId(send as never, refs, "@e1")).resolves.toEqual({
      objectId: "FRESH",
      frameId: undefined,
      sessionId: undefined,
    })
  })
})
