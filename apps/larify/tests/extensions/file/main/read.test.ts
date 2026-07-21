import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { readFileTool } from "../../../../src/extensions/file/main/read"
import { fileStateFor } from "../../../../src/extensions/file/main/state"
import { callTool, freshSession } from "./harness"

// A callTool wrapper typed for read's string result.
const read = (input: Record<string, unknown>, ctx?: { sessionId?: string; cwd?: string }) =>
  callTool<string>(readFileTool, input, ctx)

let root: string
let tenPath: string
let emptyPath: string
let crlfPath: string
let gbkPath: string
let bigPath: string
let singlePath: string
let relRoot: string

const tenContent = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n")
const chineseText =
  "你好世界，这是一段用于测试的中文文本。第二行内容也在这里，确保编码检测足够可靠。"

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-read-"))

  tenPath = path.join(root, "ten.txt")
  writeFileSync(tenPath, tenContent)

  emptyPath = path.join(root, "empty.txt")
  writeFileSync(emptyPath, "")

  // 5 CRLF-separated lines: c1..c5
  crlfPath = path.join(root, "crlf.txt")
  writeFileSync(crlfPath, "c1\r\nc2\r\nc3\r\nc4\r\nc5")

  // GBK-encoded Chinese bytes (not utf8)
  gbkPath = path.join(root, "gbk.txt")
  writeFileSync(gbkPath, iconv.encode(chineseText, "gbk"))

  // 2500 lines, larger than the default limit of 2000
  bigPath = path.join(root, "big.txt")
  writeFileSync(bigPath, Array.from({ length: 2500 }, (_, i) => `b${i + 1}`).join("\n"))

  // single line, no trailing newline
  singlePath = path.join(root, "single.txt")
  writeFileSync(singlePath, "hello")

  // relative-resolution fixture: <root>/sub/x.txt
  relRoot = path.join(root, "relroot")
  mkdirSync(path.join(relRoot, "sub"), { recursive: true })
  writeFileSync(path.join(relRoot, "sub", "x.txt"), "relative-content")
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("read", () => {
  // --- Migrated existing cases (now via the harness, fresh session each) ---

  it("reads the whole file", async () => {
    expect(await read({ file_path: tenPath }, { sessionId: freshSession() })).toBe(tenContent)
  })

  it("caps by limit with a bottom omission note", async () => {
    expect(await read({ file_path: tenPath, limit: 3 }, { sessionId: freshSession() })).toBe(
      "line1\nline2\nline3\n(Lines 4-10 omitted.)",
    )
  })

  it("shows top and bottom notes for a middle range", async () => {
    expect(
      await read({ file_path: tenPath, offset: 5, limit: 3 }, { sessionId: freshSession() }),
    ).toBe("(Lines 1-4 omitted.)\nline5\nline6\nline7\n(Lines 8-10 omitted.)")
  })

  it("shows only a top note when reading to the end", async () => {
    expect(await read({ file_path: tenPath, offset: 8 }, { sessionId: freshSession() })).toBe(
      "(Lines 1-7 omitted.)\nline8\nline9\nline10",
    )
  })

  it("clamps downward reads beyond the end of the file", async () => {
    expect(
      await read({ file_path: tenPath, offset: 100, limit: 3 }, { sessionId: freshSession() }),
    ).toBe("(Lines 1-9 omitted.)\nline10")
  })

  it("reads upward from an offset", async () => {
    expect(
      await read(
        { file_path: tenPath, offset: 8, limit: 3, scroll: "up" },
        { sessionId: freshSession() },
      ),
    ).toBe("(Lines 1-5 omitted.)\nline6\nline7\nline8\n(Lines 9-10 omitted.)")
  })

  it("reads upward from the end when offset is omitted", async () => {
    expect(
      await read({ file_path: tenPath, limit: 3, scroll: "up" }, { sessionId: freshSession() }),
    ).toBe("(Lines 1-7 omitted.)\nline8\nline9\nline10")
  })

  it("clamps upward reads beyond the end of the file", async () => {
    expect(
      await read(
        { file_path: tenPath, offset: 100, limit: 3, scroll: "up" },
        { sessionId: freshSession() },
      ),
    ).toBe("(Lines 1-7 omitted.)\nline8\nline9\nline10")
  })

  it("reads empty files without omission notes", async () => {
    expect(
      await read({ file_path: emptyPath, limit: 3, scroll: "up" }, { sessionId: freshSession() }),
    ).toBe("")
  })

  it("records the file's mtime in the session state", async () => {
    const sessionId = freshSession()
    await read({ file_path: tenPath }, { sessionId })
    const state = fileStateFor(sessionId)
    expect(state.has(tenPath)).toBe(true)
    expect(typeof state.get(tenPath)).toBe("number")
  })

  // --- New cases ---

  it("resolves a relative file_path against ctx.cwd", async () => {
    expect(
      await read({ file_path: "sub/x.txt" }, { sessionId: freshSession(), cwd: relRoot }),
    ).toBe("relative-content")
  })

  it("keys fileState by the resolved absolute path (not the relative input)", async () => {
    const sessionId = freshSession()
    await read({ file_path: "sub/x.txt" }, { sessionId, cwd: relRoot })
    const resolvedAbs = path.resolve(relRoot, "sub/x.txt")
    const state = fileStateFor(sessionId)
    expect(state.has(resolvedAbs)).toBe(true)
    // the raw relative input is never used as the key
    expect(state.has("sub/x.txt")).toBe(false)
  })

  it("decodes a GBK/GB18030 file to the correct text", async () => {
    expect(await read({ file_path: gbkPath }, { sessionId: freshSession() })).toBe(chineseText)
  })

  it("does not mis-decode a short mostly-ASCII UTF-8 file (degree sign)", async () => {
    const degPath = path.join(root, "deg.ts")
    writeFileSync(degPath, "let a = 1 // °C\n", "utf8")
    const result = await read({ file_path: degPath }, { sessionId: freshSession() })
    expect(result).toContain("°C")
    expect(result).not.toContain("Â°C")
  })

  it("returns an LF-joined body for a CRLF file with correct omission counts", async () => {
    // whole file: CRLF collapses to LF joins
    expect(await read({ file_path: crlfPath }, { sessionId: freshSession() })).toBe(
      "c1\nc2\nc3\nc4\nc5",
    )
    // a middle window: line counting reflects the 5 logical lines
    expect(
      await read({ file_path: crlfPath, offset: 2, limit: 2 }, { sessionId: freshSession() }),
    ).toBe("(Lines 1-1 omitted.)\nc2\nc3\n(Lines 4-5 omitted.)")
  })

  it("truncates a file larger than the default limit with a bottom note", async () => {
    const out = await read({ file_path: bigPath }, { sessionId: freshSession() })
    const lines = out.split("\n")
    expect(lines[0]).toBe("b1")
    expect(lines[1999]).toBe("b2000")
    expect(lines[2000]).toBe("(Lines 2001-2500 omitted.)")
    expect(lines).toHaveLength(2001)
    expect(out.startsWith("(Lines")).toBe(false) // no top note
  })

  it("clamps upward reads to line 1 with only a bottom note", async () => {
    // offset 3, limit 10 up: only 2 lines above the anchor, so start clamps to 1
    expect(
      await read(
        { file_path: tenPath, offset: 3, limit: 10, scroll: "up" },
        { sessionId: freshSession() },
      ),
    ).toBe("line1\nline2\nline3\n(Lines 4-10 omitted.)")
  })

  it("reads a single-line file with no trailing newline and no notes (both directions)", async () => {
    expect(await read({ file_path: singlePath }, { sessionId: freshSession() })).toBe("hello")
    expect(
      await read({ file_path: singlePath, scroll: "up" }, { sessionId: freshSession() }),
    ).toBe("hello")
  })

  it("rejects for a missing file (stat ENOENT)", async () => {
    await expect(
      read({ file_path: path.join(root, "does-not-exist.txt") }, { sessionId: freshSession() }),
    ).rejects.toThrow()
  })

  it("rejects for a directory path (readFile EISDIR)", async () => {
    await expect(
      read({ file_path: relRoot }, { sessionId: freshSession() }),
    ).rejects.toThrow()
  })
})
