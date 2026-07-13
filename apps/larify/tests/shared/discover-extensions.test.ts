import { describe, it, expect } from "vitest"
import { discoverExtensions } from "../../src/shared/discover-extensions"

describe("discoverExtensions", () => {
  it("derives ids from the folder under extensions/", () => {
    const load = (): Promise<unknown> => Promise.resolve({})
    const { extensions, loaders } = discoverExtensions({
      "../extensions/agent/main/index.ts": load,
      "../../extensions/assistant/renderer/index.tsx": load,
    })
    expect(extensions).toEqual([{ id: "agent" }, { id: "assistant" }])
    expect(loaders.get("agent")).toBe(load)
    expect(loaders.get("assistant")).toBe(load)
  })

  it("returns empty when there are no modules", () => {
    const { extensions, loaders } = discoverExtensions({})
    expect(extensions).toEqual([])
    expect(loaders.size).toBe(0)
  })
})
