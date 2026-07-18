import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileTool } from "../../../../src/extensions/file/main/read"
import { fileStateFor } from "../../../../src/extensions/file/main/state"

const filePath = join(tmpdir(), "larify-read-test.txt")
const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n")

beforeAll(() => writeFileSync(filePath, content))
afterAll(() => rmSync(filePath, { force: true }))

function run(args: Record<string, unknown>): Promise<string> {
  return readFileTool.execute(readFileTool.inputSchema.parse(args), { sessionId: "test" }) as Promise<string>
}

describe("read", () => {
  it("reads the whole file", async () => {
    expect(await run({ file_path: filePath })).toBe(content)
  })

  it("caps by limit with a bottom omission note", async () => {
    expect(await run({ file_path: filePath, limit: 3 })).toBe("line1\nline2\nline3\n(Lines 4-10 omitted.)")
  })

  it("shows top and bottom notes for a middle range", async () => {
    expect(await run({ file_path: filePath, offset: 5, limit: 3 })).toBe(
      "(Lines 1-4 omitted.)\nline5\nline6\nline7\n(Lines 8-10 omitted.)",
    )
  })

  it("shows only a top note when reading to the end", async () => {
    expect(await run({ file_path: filePath, offset: 8 })).toBe("(Lines 1-7 omitted.)\nline8\nline9\nline10")
  })

  it("reads upward from an offset", async () => {
    expect(await run({ file_path: filePath, offset: 8, limit: 3, scroll: "up" })).toBe(
      "(Lines 1-5 omitted.)\nline6\nline7\nline8\n(Lines 9-10 omitted.)",
    )
  })

  it("reads upward from the end when offset is omitted", async () => {
    expect(await run({ file_path: filePath, limit: 3, scroll: "up" })).toBe(
      "(Lines 1-7 omitted.)\nline8\nline9\nline10",
    )
  })

  it("clamps upward reads beyond the end of the file", async () => {
    expect(await run({ file_path: filePath, offset: 100, limit: 3, scroll: "up" })).toBe(
      "(Lines 1-7 omitted.)\nline8\nline9\nline10",
    )
  })

  it("records the file's mtime in the session state", async () => {
    await run({ file_path: filePath })
    expect(fileStateFor("test").has(filePath)).toBe(true)
  })
})
