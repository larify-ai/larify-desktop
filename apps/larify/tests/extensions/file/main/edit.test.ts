import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editFileTool } from "../../../../src/extensions/file/main/edit"
import { fileStateFor } from "../../../../src/extensions/file/main/state"

const filePath = join(tmpdir(), "larify-edit-test.txt")

function write(content: string, markRead = true): void {
  writeFileSync(filePath, content)
  if (markRead) fileStateFor("test").set(filePath, Math.floor(statSync(filePath).mtimeMs))
}

function run(args: Record<string, unknown>): Promise<string> {
  return editFileTool.execute(editFileTool.inputSchema.parse({ file_path: filePath, ...args }), {
    sessionId: "test",
  }) as Promise<string>
}

beforeEach(() => fileStateFor("test").delete(filePath))
afterAll(() => rmSync(filePath, { force: true }))

describe("edit_file", () => {
  it("replaces a unique match", async () => {
    write("hello world")
    await run({ old_string: "world", new_string: "there" })
    expect(readFileSync(filePath, "utf8")).toBe("hello there")
  })

  it("throws if the file was not read first", async () => {
    write("hello", false)
    await expect(run({ old_string: "hello", new_string: "hi" })).rejects.toThrow("must read")
  })

  it("throws if old_string is not found", async () => {
    write("hello")
    await expect(run({ old_string: "xyz", new_string: "a" })).rejects.toThrow("not found")
  })

  it("throws if old_string is not unique", async () => {
    write("a a a")
    await expect(run({ old_string: "a", new_string: "b" })).rejects.toThrow("appears 3 times")
  })

  it("replaces all with replace_all", async () => {
    write("a a a")
    await run({ old_string: "a", new_string: "b", replace_all: true })
    expect(readFileSync(filePath, "utf8")).toBe("b b b")
  })

  it("throws if old_string and new_string are identical", async () => {
    write("hi")
    await expect(run({ old_string: "x", new_string: "x" })).rejects.toThrow("identical")
  })
})
