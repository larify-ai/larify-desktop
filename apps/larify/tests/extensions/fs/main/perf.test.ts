import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editFileTool } from "../../../../src/extensions/fs/main/edit"
import { readFileTool } from "../../../../src/extensions/fs/main/read"
import { writeFileTool } from "../../../../src/extensions/fs/main/write"
import { markRead } from "../../../../src/extensions/fs/main/state"
import { callTool, freshSession } from "./harness"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "larify-fs-perf-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const bigLines = (megabytes: number, mark: { at: (n: number) => boolean; text: string }): string => {
  const line = "const value = 1234; // ordinary line of source code here"
  const n = Math.floor((megabytes * 1048576) / (line.length + 1))
  return Array.from({ length: n }, (_, i) => (mark.at(i) ? mark.text : line)).join("\n")
}

describe("fs — performance guards", () => {
  it("edits a 20MB file correctly within a generous budget", async () => {
    const abs = join(dir, "edit-big.txt")
    const n = Math.floor((20 * 1048576) / 57)
    writeFileSync(abs, bigLines(20, { at: (i) => i === (n >> 1), text: "const PERF_TARGET = 0;" }))
    const session = freshSession()
    markRead(session, abs, statSync(abs).mtimeMs)

    const started = performance.now()
    await callTool(editFileTool, { file_path: abs, old_string: "PERF_TARGET", new_string: "RENAMED" }, { sessionId: session })
    const elapsed = performance.now() - started

    expect(readFileSync(abs, "utf8")).toContain("const RENAMED = 0;")
    expect(elapsed).toBeLessThan(15000)
  }, 30000)

  it("reads a window deep inside a 20MB file within a generous budget", async () => {
    const abs = join(dir, "read-big.txt")
    const total = 20 * 1048576
    writeFileSync(abs, bigLines(20, { at: (i) => i === 1, text: "const NEEDLE = 0;" }))
    const lineCount = Math.floor(total / 57)

    const started = performance.now()
    const out = await callTool<string>(
      readFileTool,
      { file_path: abs, offset: lineCount >> 1, limit: 2000 },
      { sessionId: freshSession() },
    )
    const elapsed = performance.now() - started

    expect(out.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(10000)
  }, 30000)

  it("writes a multi-megabyte file within a generous budget", async () => {
    const abs = join(dir, "write-big.txt")
    const content = `${"a line of generated content\n".repeat(120000)}`

    const started = performance.now()
    await callTool(writeFileTool, { file_path: abs, content }, { sessionId: freshSession() })
    const elapsed = performance.now() - started

    expect(statSync(abs).size).toBeGreaterThan(3 * 1048576)
    expect(elapsed).toBeLessThan(10000)
  }, 30000)
})
