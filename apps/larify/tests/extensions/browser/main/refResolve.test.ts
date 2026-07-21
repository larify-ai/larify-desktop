import { describe, expect, it, vi } from "vitest"
import { parseRef, resolveRefToObjectId } from "../../../../src/extensions/browser/main/refResolve"

describe("parseRef", () => {
  it("accepts ref tokens and rejects selectors", () => {
    expect(parseRef("@e123")).toBe("e123")
    expect(parseRef("ref=e5")).toBe("e5")
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

describe("resolveRefToObjectId selector path", () => {
  it("returns the objectId for a matching selector", async () => {
    const send = vi.fn(async () => ({ result: { objectId: "OID" } }))
    await expect(resolveRefToObjectId(send as never, new Map(), "button")).resolves.toEqual({
      objectId: "OID",
    })
  })

  it("throws for a malformed selector even when the exception object carries an objectId", async () => {
    const send = vi.fn(async () => ({
      result: { objectId: "EXCEPTION_OBJECT" },
      exceptionDetails: { text: "SyntaxError: bad selector" },
    }))
    await expect(resolveRefToObjectId(send as never, new Map(), "input[name=q")).rejects.toThrow(
      "selector 'input[name=q' is invalid",
    )
  })

  it("throws matched-no-element when a valid selector finds nothing", async () => {
    const send = vi.fn(async () => ({ result: {} }))
    await expect(resolveRefToObjectId(send as never, new Map(), ".missing")).rejects.toThrow(
      "matched no element",
    )
  })
})
