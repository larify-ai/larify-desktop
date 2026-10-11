import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { readFileTool, readFileWindow } from "../../../../src/extensions/fs/main/read"
import { readAtFor } from "../../../../src/extensions/fs/main/state"
import { callTool, freshSession } from "./harness"

const read = (
  input: { file_path: string; offset?: number; column?: number; limit?: number; scroll?: "down" | "up" },
  ctx?: { sessionId?: string; cwd?: string },
): Promise<string> =>
  readFileWindow(
    { column: 1, limit: 50_000, scroll: "down", ...input },
    { sessionId: ctx?.sessionId ?? "test", cwd: ctx?.cwd ?? tmpdir() },
  )

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
    const at = /Continue from offset (\d+)(?: column (\d+))?/.exec(tail)
    if (!at) break
    next = { file_path: file, limit, offset: Number(at[1]), column: at[2] ? Number(at[2]) : 1 }
  }
  return parts.join("")
}

describe("read", () => {
  it("treats offset 0 and 1 as the first line", async () => {
    const first = await callTool<string>(readFileTool, { file_path: tenPath, offset: 1 })
    const zero = await callTool<string>(readFileTool, { file_path: tenPath, offset: 0 })

    expect(zero).toBe(first)
  })

  it("reads the whole file with no notes", async () => {
    expect(await read({ file_path: tenPath }, { sessionId: freshSession() })).toBe(tenContent)
  })

  it("stops at the character budget and says where to continue", async () => {
    const output = await read({ file_path: tenPath, limit: 17 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line1\nline2\nline3")
    expect(output).toContain("(Continue from offset 3 column 6.)")
  })

  it("starts at the requested line and notes what came before", async () => {
    const output = await read({ file_path: tenPath, offset: 5 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line5\nline6\nline7\nline8\nline9\nline10")
    expect(output).toContain("(Omitted before offset 5.)")
  })

  it("shows both notes for a window in the middle", async () => {
    const output = await read({ file_path: tenPath, offset: 5, limit: 17 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line5\nline6\nline7")
    expect(output).toContain("Omitted before offset 5.")
    expect(output).toContain("Continue from offset 7 column 6.")
  })

  it("clamps a start line past the end of the file", async () => {
    const output = await read({ file_path: tenPath, offset: 100 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("line10")
  })

  it("reads the tail when scrolling up from the end", async () => {
    const output = await read({ file_path: tenPath, limit: 17, scroll: "up" }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe("ine8\nline9\nline10")
    expect(output).toContain("Omitted before offset 8 column 2.")
    expect(output).not.toContain("Continue from")
  })

  it("clamps an upward read to the start of the file", async () => {
    const output = await read(
      { file_path: tenPath, offset: 3, limit: 1000, scroll: "up" },
      { sessionId: freshSession() },
    )

    expect(bodyOf(output)).toBe("line1\nline2\n")
    expect(output).toContain("Continue from offset 3")
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

describe("代理对不被切断（emoji / 数学符号）", () => {
  // 'a'×9 + '🙂'(占 2 码元) + 'b'×10 ⇒ 码元下标 9、10 是那一对
  const source = `${"a".repeat(9)}🙂${"b".repeat(10)}`
  const fileOf = (name: string, content: string): string => {
    const file = path.join(root, name)
    writeFileSync(file, content)
    return file
  }

  it("limit 切在代理对中间时读到完整字符，而非半个（孤立代理）", async () => {
    const file = fileOf("astral.txt", source)

    const output = await read({ file_path: file, limit: 10 }, { sessionId: freshSession() })

    expect(bodyOf(output)).toBe(`${"a".repeat(9)}🙂`)
    expect(output.isWellFormed()).toBe(true)
    expect(output).toContain("Continue from offset 1 column 12.")
  })

  it("向上回读时起点也落在完整字符上", async () => {
    const file = fileOf("astral-up.txt", source)

    // anchor=21、limit=11 ⇒ from=10（恰是低代理）⇒ 起点回退到该字符的高代理
    const output = await read(
      { file_path: file, limit: 11, scroll: "up" },
      { sessionId: freshSession() },
    )

    expect(bodyOf(output)).toBe(`🙂${"b".repeat(10)}`)
    expect(output.isWellFormed()).toBe(true)
    // 起点回退到高代理后，真正被省略的是前 9 个字符 ⇒ 描述须按回退后的下标算
    expect(output).toContain("Omitted before offset 1 column 10.")
  })

  it("跨 1MB 分片的切点同样读到完整字符", async () => {
    const chunk = 1 << 20
    const source = `${"a".repeat(chunk + 100)}🙂${"b".repeat(10)}`
    const file = fileOf("astral-chunk.txt", source)
    const anchor = chunk + 101 // 恰是 🙂 的低代理（U+1F642 = \ud83d\ude42）

    // 对照：朴素切片（旧实现）从 anchor 起读会留下孤立低代理
    expect(source.slice(anchor, anchor + 1)).toBe("\ude42")

    const output = await read(
      { file_path: file, offset: 1, column: anchor + 1, limit: 5000 },
      { sessionId: freshSession() },
    )

    expect(output.isWellFormed()).toBe(true)
    expect(bodyOf(output)).toBe(`🙂${"b".repeat(10)}`)
  })

  it("翻页重建与原文逐字符一致，且每一页都不含孤立代理", async () => {
    const file = fileOf("astral-page.txt", source)
    const pages: string[] = []
    let next: Record<string, unknown> = { file_path: file, limit: 10 }

    for (let page = 0; page < 20; page++) {
      const output = await read(next, { sessionId: freshSession() })
      expect(output.isWellFormed(), `第 ${page + 1} 页含孤立代理`).toBe(true)
      const rows = output.split("\n")
      const tail = rows.at(-1)?.startsWith("(Continue from ") ? rows.pop() : undefined
      if (rows[0]?.startsWith("(Omitted before ")) rows.shift()
      pages.push(rows.join("\n"))
      if (!tail) break
      const at = /Continue from offset (\d+)(?: column (\d+))?/.exec(tail)
      if (!at) break
      next = { file_path: file, limit: 10, offset: Number(at[1]), column: at[2] ? Number(at[2]) : 1 }
    }

    expect(pages.join("")).toBe(source)
  })

  it("事故同形：切点恰在 𝑣（U+1D463）中间时读到完整字符", async () => {
    const file = fileOf("math.txt", `${"x".repeat(54_999)}𝑣${"y".repeat(10)}`)

    const output = await read({ file_path: file, limit: 55_000 }, { sessionId: freshSession() })

    expect(output.isWellFormed()).toBe(true)
    expect(bodyOf(output).endsWith("𝑣")).toBe(true)
  })
})
