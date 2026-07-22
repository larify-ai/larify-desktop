import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readFileTool } from "../../../../src/extensions/file/main/read"
import { editFileTool } from "../../../../src/extensions/file/main/edit"
import { writeFileTool } from "../../../../src/extensions/file/main/write"
import { callTool, freshSession } from "./harness"

let root: string
let session: string

const read = (input: Record<string, unknown>) =>
  callTool<string>(readFileTool, input, { sessionId: session })
const edit = (input: Record<string, unknown>) =>
  callTool<{ summary: string; patch: string }>(editFileTool, input, { sessionId: session })
const write = (input: Record<string, unknown>) =>
  callTool<{ summary: string; patch: string }>(writeFileTool, input, { sessionId: session })

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-eol-"))
  session = freshSession()
})

afterAll(() => {
  rmSync(root, { force: true, recursive: true })
})

function crlfFile(name: string, lines: string[]): string {
  const file = path.join(root, name)
  writeFileSync(file, lines.join("\r\n") + "\r\n")
  return file
}

describe("read -> edit handoff on a CRLF file", () => {
  it("edits a multi-line block copied verbatim out of read's own output", async () => {
    const file = crlfFile("a.ts", ["const a = 1", "const b = 2", "const c = 3"])

    const shown = await read({ file_path: file })
    const oldString = shown.split("\n").slice(0, 2).join("\n")
    expect(oldString).toBe("const a = 1\nconst b = 2")

    const result = await edit({
      file_path: file,
      old_string: oldString,
      new_string: "const a = 10\nconst b = 20",
    })

    expect(result.summary).toContain("Edited")
    expect(readFileSync(file, "utf8")).toBe("const a = 10\nconst b = 20\nconst c = 3\n")
  })

  it("still edits when the model sends CRLF in old_string", async () => {
    const file = crlfFile("b.ts", ["x1", "x2", "x3"])
    await read({ file_path: file })

    await edit({ file_path: file, old_string: "x1\r\nx2", new_string: "y1\r\ny2" })

    expect(readFileSync(file, "utf8")).toBe("y1\ny2\nx3\n")
  })

  it("keeps a single-line edit working unchanged", async () => {
    const file = crlfFile("c.ts", ["keep", "target", "keep2"])
    await read({ file_path: file })

    await edit({ file_path: file, old_string: "target", new_string: "changed" })

    expect(readFileSync(file, "utf8")).toBe("keep\nchanged\nkeep2\n")
  })

  it("produces a patch that only mentions the edited lines", async () => {
    const file = crlfFile("d.ts", ["l1", "l2", "l3", "l4", "l5"])
    await read({ file_path: file })

    const result = await edit({ file_path: file, old_string: "l2\nl3", new_string: "L2\nL3" })

    const changed = result.patch
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    expect(changed).toEqual(["-l2", "-l3", "+L2", "+L3"])
  })

  it("reports old_string not found only when it is genuinely absent", async () => {
    const file = crlfFile("e.ts", ["a1", "a2"])
    await read({ file_path: file })

    await expect(
      edit({ file_path: file, old_string: "nope\nnothing", new_string: "x" }),
    ).rejects.toThrow("old_string not found")
  })
})

describe("write on a CRLF file", () => {
  it("does not report the whole file as changed", async () => {
    const file = crlfFile("f.ts", ["w1", "w2", "w3"])
    await read({ file_path: file })

    const result = await write({ file_path: file, content: "w1\nw2\nCHANGED\n" })

    const changed = result.patch
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    expect(changed).toEqual(["-w3", "+CHANGED"])
    expect(readFileSync(file, "utf8")).toBe("w1\nw2\nCHANGED\n")
  })
})
