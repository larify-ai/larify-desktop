import { describe, expect, it, vi } from "vitest"
import { JSDOM } from "jsdom"

vi.mock("../../../../src/extensions/browser/main/refResolve", () => ({
  resolveRefToObjectId: vi.fn(async () => ({ objectId: "OID", sessionId: "SID" })),
  resolveRefToBox: vi.fn(async () => ({ x: 0, y: 0, sessionId: "SID" })),
}))

import {
  callOn,
  check,
  fill,
  select,
  type as typeInto,
} from "../../../../src/extensions/browser/main/interactions"

interface Call {
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

function makeCtx(): { ctx: Parameters<typeof fill>[0]; calls: Call[] } {
  const calls: Call[] = []
  const send = vi.fn(async (method: string, params: Record<string, unknown>, sessionId?: string) => {
    calls.push({ method, params, sessionId })
    return { result: { value: undefined } }
  })
  return {
    ctx: { send, refMap: new Map(), sessions: undefined } as unknown as Parameters<typeof fill>[0],
    calls,
  }
}

describe("interactions sessionId threading", () => {
  it("throws when Runtime.callFunctionOn reports an exception", async () => {
    const send = vi.fn(async () => ({
      result: { type: "object", subtype: "error" },
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "Error: detached node" },
      },
    }))

    await expect(callOn(send as never, "OID", "function(){ return this.value; }")).rejects.toThrow(
      "Error: detached node",
    )
  })

  it("fill inserts text into the resolved frame session", async () => {
    const { ctx, calls } = makeCtx()

    await fill(ctx, "ref_1", "hello")

    const insert = calls.find((c) => c.method === "Input.insertText")
    expect(insert).toMatchObject({ params: { text: "hello" }, sessionId: "SID" })
  })

  it("fill clears contenteditable via textContent rather than value", async () => {
    const { ctx, calls } = makeCtx()

    await fill(ctx, "ref_1", "hello")

    const clearCall = calls.find(
      (c) =>
        c.method === "Runtime.callFunctionOn" &&
        String((c.params as { functionDeclaration?: string }).functionDeclaration).includes("this.value=''"),
    )
    const decl = String((clearCall?.params as { functionDeclaration: string }).functionDeclaration)
    expect(decl).toContain("isContentEditable")
    expect(decl).toContain("this.textContent=''")
  })

  it("type dispatches keys and text into the resolved frame session", async () => {
    const { ctx, calls } = makeCtx()

    await typeInto(ctx, "ref_1", "a\tb", false, 0)

    const keyEvents = calls.filter((c) => c.method === "Input.dispatchKeyEvent")
    const textEvents = calls.filter((c) => c.method === "Input.insertText")

    expect(keyEvents.length).toBeGreaterThan(0)
    expect(keyEvents.every((c) => c.sessionId === "SID")).toBe(true)
    expect(textEvents.map((c) => c.params.text)).toEqual(["a", "b"])
    expect(textEvents.every((c) => c.sessionId === "SID")).toBe(true)
  })

  it("stops delayed typing when the operation is aborted", async () => {
    const { ctx, calls } = makeCtx()
    const controller = new AbortController()
    const pending = typeInto(ctx, "ref_1", "abc", false, 10_000, controller.signal)
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === "Input.insertText")).toBe(true)
    })

    controller.abort()

    await expect(pending).rejects.toThrow("typing was cancelled")
    expect(calls.filter((call) => call.method === "Input.insertText")).toHaveLength(1)
  })

  it("does not wait or fail on cancellation after the final character", async () => {
    const { ctx } = makeCtx()
    const controller = new AbortController()
    vi.mocked(ctx.send).mockImplementation(async (method) => {
      if (method === "Input.insertText") controller.abort()
      return { result: { value: undefined } }
    })

    await expect(
      typeInto(ctx, "ref_1", "a", false, 10_000, controller.signal),
    ).resolves.toBeUndefined()
  })

  it("does not report check success when the element remains unchecked", async () => {
    const { ctx } = makeCtx()
    vi.mocked(ctx.send).mockImplementation(async (method, params) => {
      if (
        method === "Runtime.callFunctionOn" &&
        String((params as { functionDeclaration?: string }).functionDeclaration).includes(
          "aria-checked",
        )
      ) {
        return { result: { value: false } }
      }
      return { result: { value: undefined } }
    })

    await expect(check(ctx, "ref_1")).rejects.toThrow("remains unchecked")
  })

  it("does not silently select only the matching subset of requested values", async () => {
    const { ctx } = makeCtx()
    const element = {
      options: [
        { value: "a", textContent: "Alpha", selected: false },
        { value: "b", textContent: "Beta", selected: false },
      ],
      dispatchEvent: vi.fn(),
    }
    vi.mocked(ctx.send).mockImplementation(async (method, params) => {
      if (method !== "Runtime.callFunctionOn") return {}
      const declaration = String(
        (params as { functionDeclaration?: string }).functionDeclaration,
      )
      const args = (
        (params as { arguments?: Array<{ value: unknown }> }).arguments ?? []
      ).map(({ value }) => value)
      const fn = Function(`return (${declaration})`)() as (
        this: typeof element,
        ...values: unknown[]
      ) => unknown
      return { result: { value: fn.apply(element, args) } }
    })

    await expect(select(ctx, "ref_1", ["a", "missing"])).rejects.toThrow(
      'No option matched "missing"',
    )
    expect(element.options[0].selected).toBe(false)
  })

  it("rejects multiple values for a single-select before changing its selection", async () => {
    const { ctx } = makeCtx()
    const dom = new JSDOM(
      '<select><option value="a" selected>Alpha</option><option value="b">Beta</option></select>',
      { runScripts: "outside-only" },
    )
    const element = dom.window.document.querySelector("select")!
    vi.mocked(ctx.send).mockImplementation(async (method, params) => {
      if (method !== "Runtime.callFunctionOn") return {}
      const declaration = String(
        (params as { functionDeclaration?: string }).functionDeclaration,
      )
      const args = (
        (params as { arguments?: Array<{ value: unknown }> }).arguments ?? []
      ).map(({ value }) => value)
      const fn = dom.window.Function(`return (${declaration})`)() as (
        this: HTMLSelectElement,
        ...values: unknown[]
      ) => unknown
      return { result: { value: fn.apply(element, args) } }
    })

    await expect(select(ctx, "ref_1", ["a", "b"])).rejects.toThrow(
      "multiple values for a single-select",
    )
    expect(element.value).toBe("a")
    dom.window.close()
  })
})
