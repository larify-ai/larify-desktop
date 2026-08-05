import { describe, expect, it } from "vitest"
import { markRead, readAtFor } from "../../../../src/extensions/fs/main/state"

describe("fileState 会话数上限（防泄漏）", () => {
  it("超过上限后淘汰最久未用的会话", () => {
    for (let i = 0; i <= 100; i++) markRead(`a${i}`, "/f", 1000)

    expect(readAtFor("a0", "/f")).toBeUndefined()
    expect(readAtFor("a100", "/f")).toBe(1000)
  })

  it("被重新访问的会话不会被淘汰", () => {
    markRead("bkeep", "/f", 1000)
    for (let i = 0; i < 100; i++) {
      markRead(`b${i}`, "/f", 1000)
      markRead("bkeep", "/f", 1000)
    }

    expect(readAtFor("bkeep", "/f")).toBe(1000)
  })
})
