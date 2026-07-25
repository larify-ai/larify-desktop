import { describe, expect, it } from "vitest"
import { globFilesTool } from "../../../../src/extensions/file/main/glob"
import { grepFilesTool } from "../../../../src/extensions/file/main/grep"
import { lsTool } from "../../../../src/extensions/file/main/ls"
import { readFileTool } from "../../../../src/extensions/file/main/read"

const parse = (tool: unknown, input: unknown) =>
  (tool as { inputSchema: { parse: (v: unknown) => unknown } }).inputSchema.parse(input)

describe("每个 limit 都有上界", () => {
  const cases = [
    { name: "ls", tool: lsTool, base: {}, max: 1000 },
    { name: "glob", tool: globFilesTool, base: { pattern: "*" }, max: 1000 },
    { name: "grep", tool: grepFilesTool, base: { pattern: "x" }, max: 1000 },
  ]

  for (const { name, tool, base, max } of cases) {
    it(`${name} 接受上界本身,拒绝超出`, () => {
      expect(() => parse(tool, { ...base, limit: max })).not.toThrow()
      expect(() => parse(tool, { ...base, limit: max + 1 })).toThrow()
    })
  }

  it("read clamps limits to its supported range", () => {
    expect(parse(readFileTool, { file_path: "a.txt", limit: -1 })).toMatchObject({ limit: 5_000 })
    expect(parse(readFileTool, { file_path: "a.txt", limit: 101 })).toMatchObject({
      limit: 100_000,
    })
  })
})
