import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { readFileTool } from "../../../../src/extensions/file/main/read"
import { readAtFor } from "../../../../src/extensions/file/main/state"
import { callTool, freshSession } from "./harness"

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
const bigContent = Array.from({ length: 2500 }, (_, i) => `b${i + 1}`).join("\n")
const chineseText =
  "你好世界，这是一段用于测试的中文文本。第二行内容也在这里，确保编码检测足够可靠。"

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-read-"))

  tenPath = path.join(root, "ten.txt")
  writeFileSync(tenPath, tenContent)

  emptyPath = path.join(root, "empty.txt")
  writeFileSync(emptyPath, "")

  crlfPath = path.join(root, "crlf.txt")
  writeFileSync(crlfPath, "c1\r\nc2\r\nc3\r\nc4\r\nc5")

  gbkPath = path.join(root, "gbk.txt")
  writeFileSync(gbkPath, iconv.encode(chineseText, "gbk"))

  bigPath = path.join(root, "big.txt")
  writeFileSync(bigPath, bigContent)

  singlePath = path.join(root, "single.txt")
  writeFileSync(singlePath, "hello")

  relRoot = path.join(root, "relroot")
  mkdirSync(path.join(relRoot, "sub"), { recursive: true })
  writeFileSync(path.join(relRoot, "sub", "x.txt"), "relative-content")
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const NOTE = /^\((Omitted before|Continue from)/

const bodyOf = (output: string): string =>
  output
    .split("\n")
    .filter((row) => !NOTE.test(row))
    .join("\n")

async function pageThrough(file: string, limit: number): Promise<string> {
  const parts: string[] = []
  let next: Record<string, unknown> = { file_path: file, limit }
  for (let page = 0; page < 500; page++) {
    const output = await read(next, { sessionId: freshSession() })
    const rows = output.split("\n")
    const tail = rows.at(-1)?.startsWith("(Continue from ") ? rows.pop() : undefined
    if (rows[0]?.startsWith("(Omitted before ")) rows.shift()
    parts.push(rows.join("\n"))
    if (!tail) break
    const at = /Continue from line (\d+)(?: column (\d+))?/.exec(tail)
    if (!at) break
    next = { file_path: file, limit, line: Number(at[1]), column: at[2] ? Number(at[2]) : 1 }
  }
  return parts.join("")
}

describe("read", () => {
  it("reads the whole file with no notes", async () => {
    expect(await read({ file_path: tenPath }, { sessionId: freshSession() })).toBe(tenContent)
  })

  it("stops at the character budget and says where to continue", async () => {
    const output = await read({ file_path: tenPath, limit: 17 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line1\nline2\nline3")
    expect(output).toContain("(Continue from line 3 column 6.)")
  })

  it("starts at the requested line and notes what came before", async () => {
    const output = await read({ file_path: tenPath, line: 5 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line5\nline6\nline7\nline8\nline9\nline10")
    expect(output).toContain("(Omitted before line 5.)")
  })

  it("shows both notes for a window in the middle", async () => {
    const output = await read({ file_path: tenPath, line: 5, limit: 17 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line5\nline6\nline7")
    expect(output).toContain("Omitted before line 5.")
    expect(output).toContain("Continue from line 7 column 6.")
  })

  it("clamps a start line past the end of the file", async () => {
    const output = await read({ file_path: tenPath, line: 100 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line10")
  })

  it("reads the tail when scrolling up from the end", async () => {
    const output = await read({ file_path: tenPath, limit: 17, scroll: "up" }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("ine8\nline9\nline10")
    expect(output).toContain("Omitted before line 8 column 2.")
    expect(output).not.toContain("Continue from")
  })

  it("clamps an upward read to the start of the file", async () => {
    const output = await read(
      { file_path: tenPath, line: 3, limit: 1000, scroll: "up" },
      { sessionId: freshSession() },
    )

    expect(bodyOf(output)).toBe("line1\nline2\n")
    expect(output).toContain("Continue from line 3")
  })

  it("reads an empty file without notes", async () => {
    expect(await read({ file_path: emptyPath }, { sessionId: freshSession() })).toBe("")
  })

  it("reads a single-line file with no trailing newline in both directions", async () => {
    expect(await read({ file_path: singlePath }, { sessionId: freshSession() })).toBe("hello")
    expect(await read({ file_path: singlePath, scroll: "up" }, { sessionId: freshSession() })).toBe("hello")
  })

  it("returns an LF-joined body for a CRLF file", async () => {
    expect(await read({ file_path: crlfPath }, { sessionId: freshSession() })).toBe("c1\nc2\nc3\nc4\nc5")
  })

  it("decodes a GBK file to the correct text", async () => {
    expect(await read({ file_path: gbkPath }, { sessionId: freshSession() })).toBe(chineseText)
  })

  it("does not mis-decode a short mostly-ASCII UTF-8 file (degree sign)", async () => {
    const degPath = path.join(root, "deg.ts")
    writeFileSync(degPath, "let a = 1 // °C\n", "utf8")

    const result = await read({ file_path: degPath }, { sessionId: freshSession() })

    expect(result).toContain("°C")
    expect(result).not.toContain("Â°C")
  })

  it("returns a large file whole when it fits the default budget", async () => {
    const output = await read({ file_path: bigPath }, { sessionId: freshSession() })

    expect(output).toBe(bigContent)
  })

  it("reconstructs a file exactly by following the continue hints", async () => {
    expect(await pageThrough(bigPath, 1000)).toBe(bigContent)
  })

  it("reconstructs a file that is one line longer than the budget", async () => {
    const onePath = path.join(root, "one.txt")
    const source = "A".repeat(20_000)
    writeFileSync(onePath, source)

    expect(await pageThrough(onePath, 4096)).toBe(source)
  })

  it("records the file's mtime in the session state", async () => {
    const sessionId = freshSession()

    await read({ file_path: tenPath }, { sessionId })

    expect(typeof readAtFor(sessionId, tenPath)).toBe("number")
  })

  it("resolves a relative file_path against ctx.cwd", async () => {
    expect(await read({ file_path: "sub/x.txt" }, { sessionId: freshSession(), cwd: relRoot })).toBe(
      "relative-content",
    )
  })

  it("keys read state by the resolved absolute path", async () => {
    const sessionId = freshSession()

    await read({ file_path: "sub/x.txt" }, { sessionId, cwd: relRoot })

    expect(readAtFor(sessionId, path.resolve(relRoot, "sub/x.txt"))).toBeTypeOf("number")
    expect(readAtFor(sessionId, "sub/x.txt")).toBeUndefined()
  })

  it("rejects a missing file", async () => {
    await expect(
      read({ file_path: path.join(root, "does-not-exist.txt") }, { sessionId: freshSession() }),
    ).rejects.toThrow()
  })

  it("rejects a directory path", async () => {
    await expect(read({ file_path: relRoot }, { sessionId: freshSession() })).rejects.toThrow()
  })

})
