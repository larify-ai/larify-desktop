import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeFileTool } from "../../../../src/extensions/file/main/write"
import { fileStateFor } from "../../../../src/extensions/file/main/state"

const filePath = join(tmpdir(), "larify-write-test.txt")

function markRead(): void {
  fileStateFor("test").set(filePath, Math.floor(statSync(filePath).mtimeMs))
}

function run(args: Record<string, unknown>) {
  return writeFileTool.execute(writeFileTool.inputSchema.parse({ file_path: filePath, ...args }), {
    sessionId: "test",
  })
}

beforeEach(() => {
  rmSync(filePath, { force: true })
  fileStateFor("test").delete(filePath)
})

afterAll(() => rmSync(filePath, { force: true }))

describe("write_file", () => {
  it("creates a new file", async () => {
    const result = await run({ content: "hello" })
    expect(readFileSync(filePath, "utf8")).toBe("hello")
    expect(result).toMatchObject({
      output: `File created successfully at: ${filePath}`,
      metadata: { kind: "diff", type: "create", oldContent: null, newContent: "hello" },
    })
    expect((result as { metadata: { patch: string } }).metadata.patch).toContain("+hello")
  })

  it("throws if an existing file was not read first", async () => {
    writeFileSync(filePath, "old")
    await expect(run({ content: "new" })).rejects.toThrow("must read")
    expect(readFileSync(filePath, "utf8")).toBe("old")
  })

  it("overwrites an existing file after it has been read", async () => {
    writeFileSync(filePath, "old")
    markRead()
    const result = await run({ content: "new" })
    expect(readFileSync(filePath, "utf8")).toBe("new")
    expect(result).toMatchObject({
      output: `The file ${filePath} has been updated successfully.`,
      metadata: { kind: "diff", type: "update", oldContent: "old", newContent: "new" },
    })
    expect((result as { metadata: { patch: string } }).metadata.patch).toContain("-old")
    expect((result as { metadata: { patch: string } }).metadata.patch).toContain("+new")
  })

  it("creates parent directories", async () => {
    const nestedPath = join(tmpdir(), "larify-write-parent", "nested.txt")
    rmSync(join(tmpdir(), "larify-write-parent"), { force: true, recursive: true })
    await writeFileTool.execute(
      writeFileTool.inputSchema.parse({ file_path: nestedPath, content: "nested" }),
      { sessionId: "test" },
    )
    expect(existsSync(nestedPath)).toBe(true)
    rmSync(join(tmpdir(), "larify-write-parent"), { force: true, recursive: true })
  })
})
