import { describe, expect, it, vi } from "vitest"

vi.mock("../../../../src/extensions/browser/main/refResolve", () => ({
  resolveRefToObjectId: vi.fn(async () => ({ objectId: "OID", sessionId: "SID" })),
  resolveRefToBox: vi.fn(async () => ({ x: 0, y: 0, sessionId: "SID" })),
}))

import { callOn, fill, type as typeInto } from "../../../../src/extensions/browser/main/interactions"

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
})
