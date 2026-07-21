import { describe, expect, it, vi } from "vitest"

vi.mock("../../../../src/extensions/browser/main/refResolve", () => ({
  resolveRefToObjectId: vi.fn(async () => ({ objectId: "OID", sessionId: "SID" })),
  resolveRefToBox: vi.fn(async () => ({ x: 0, y: 0, sessionId: "SID" })),
}))

import { fill, type as typeInto } from "../../../../src/extensions/browser/main/interactions"

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
  it("fill inserts text into the resolved frame session", async () => {
    const { ctx, calls } = makeCtx()

    await fill(ctx, "ref_1", "hello")

    const insert = calls.find((c) => c.method === "Input.insertText")
    expect(insert).toMatchObject({ params: { text: "hello" }, sessionId: "SID" })
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
