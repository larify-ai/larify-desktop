import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { afterAll, describe, expect, it } from "vitest"
import { readFileTool, readFileWindow } from "../../../../src/extensions/fs/main/read"
import { readAtFor } from "../../../../src/extensions/fs/main/state"
import { splitLines } from "../../../../src/main/utils/text"
import { callTool, freshSession } from "./harness"

const root = mkdtempSync(path.join(tmpdir(), "larify-read-stream-"))

afterAll(() => rmSync(root, { force: true, recursive: true }))

interface Params {
  line?: number
  column: number
  limit: number
  scroll: "down" | "up"
}

const lineStarts = (lines: string[]): number[] => {
  const starts: number[] = []
  let at = 0
  for (const text of lines) {
    starts.push(at)
    at += text.length + 1
  }
  return starts
}

const positionOf = (starts: number[], index: number): string => {
  let line = starts.length
  while (line > 1 && starts[line - 1] > index) line -= 1
  const column = index - starts[line - 1] + 1
  return column === 1 ? `line ${line}` : `line ${line} column ${column}`
}

const reference = (content: string, { line, column, limit, scroll }: Params): string => {
  const lines = splitLines(content)
  const text = lines.join("\n")
  const starts = lineStarts(lines)
  const anchorOnLine = (): number => {
    const index = Math.min(line as number, lines.length) - 1
    return Math.min(starts[index] + column - 1, starts[index] + lines[index].length)
  }
  const anchor = Math.min(
    line === undefined ? (scroll === "up" ? text.length : 0) : anchorOnLine(),
    text.length,
  )
  const start = Math.max(0, Math.min(scroll === "up" ? anchor - limit : anchor, text.length))
  const end = Math.max(start, Math.min(scroll === "up" ? anchor : anchor + limit, text.length))
  return [
    start > 0 ? `(Omitted before ${positionOf(starts, start)}.)` : null,
    text.slice(start, end),
    end < text.length ? `(Continue from ${positionOf(starts, end)}.)` : null,
  ]
    .filter((part) => part !== null)
    .join("\n")
}

let seq = 0
const actual = (content: string | Buffer, params: Params): Promise<string> => {
  const file = path.join(root, `f${seq++}.txt`)
  writeFileSync(file, content)
  return readFileWindow(
    { file_path: file, ...params },
    { sessionId: freshSession(), cwd: root },
  )
}

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe("流式实现与原实现逐字节一致", () => {
  const shapes: Array<[string, string]> = [
    ["空文件", ""],
    ["单行无换行", "only one line"],
    ["普通多行", "a\nbb\nccc\ndddd\n"],
    ["CRLF", "a\r\nbb\r\nccc\r\n"],
    ["混合换行", "a\r\nbb\nccc\rdddd\n"],
    ["结尾无换行", "a\nbb\nccc"],
    ["连续空行", "a\n\n\n\nb\n"],
    ["超长单行", "H" + "y".repeat(5000) + "T"],
    ["长行夹短行", "short\n" + "z".repeat(3000) + "\nshort2\n"],
    ["中文", "第一行\n第二行内容\n第三行\n"],
    ["只有换行", "\n\n\n"],
  ]

  for (const [name, content] of shapes) {
    it(name, async () => {
      const cases: Params[] = [
        { column: 1, limit: 10, scroll: "down" },
        { column: 1, limit: 10, scroll: "up" },
        { column: 1, limit: 50_000, scroll: "down" },
        { column: 1, limit: 50_000, scroll: "up" },
        { line: 1, column: 1, limit: 5, scroll: "down" },
        { line: 1, column: 3, limit: 5, scroll: "down" },
        { line: 2, column: 1, limit: 7, scroll: "down" },
        { line: 2, column: 2, limit: 7, scroll: "up" },
        { line: 3, column: 1, limit: 100, scroll: "down" },
        { line: 999, column: 1, limit: 20, scroll: "down" },
        { line: 1, column: 999, limit: 20, scroll: "down" },
        { line: 1, column: 999, limit: 20, scroll: "up" },
        { line: 2, column: 999, limit: 30, scroll: "up" },
        { line: 999, column: 999, limit: 30, scroll: "up" },
        { line: 2, column: 4, limit: 4, scroll: "up" },
      ]
      for (const params of cases) {
        const got = await actual(content, params)
        expect(got, `${name} / ${JSON.stringify(params)}`).toBe(reference(content, params))
      }
    })
  }

  it("随机文件与随机参数各 200 组", async () => {
    const rand = mulberry(20260722)
    for (let round = 0; round < 200; round++) {
      const lineCount = 1 + Math.floor(rand() * 40)
      const parts: string[] = []
      for (let i = 0; i < lineCount; i++) {
        const width = Math.floor(rand() * 30)
        parts.push("abcdefghij".repeat(Math.ceil(width / 10)).slice(0, width))
      }
      const breaks = ["\n", "\r\n", "\r"]
      let content = ""
      for (const part of parts) content += part + breaks[Math.floor(rand() * 3)]
      if (rand() < 0.3) content = content.slice(0, -1)

      const params: Params = {
        line: rand() < 0.3 ? undefined : 1 + Math.floor(rand() * (lineCount + 3)),
        column: rand() < 0.25 ? 1 + Math.floor(rand() * 2000) : 1 + Math.floor(rand() * 12),
        limit: 1 + Math.floor(rand() * 120),
        scroll: rand() < 0.5 ? "down" : "up",
      }
      const got = await actual(content, params)
      expect(got, `round ${round} / ${JSON.stringify(params)} / ${JSON.stringify(content)}`).toBe(
        reference(content, params),
      )
    }
  }, 240_000)
})

describe("column 超出行长时夹在该行末尾, 不溢出到下一行", () => {
  const content = "AAA\nBBB\nCCC\nDDD\n"

  it("恰好等于行长加一时停在换行符之前", async () => {
    const got = await actual(content, { line: 1, column: 4, limit: 6, scroll: "down" })

    expect(got).toBe("(Omitted before line 1 column 4.)\n\nBBB\nC\n(Continue from line 3 column 2.)")
  })

  it("远超行长也只停在同一行末尾", async () => {
    const far = await actual(content, { line: 1, column: 999, limit: 6, scroll: "down" })
    const edge = await actual(content, { line: 1, column: 4, limit: 6, scroll: "down" })

    expect(far).toBe(edge)
  })

  it("中间一行同样不越界", async () => {
    const got = await actual(content, { line: 2, column: 999, limit: 4, scroll: "down" })

    expect(got).toBe("(Omitted before line 2 column 4.)\n\nCCC\n(Continue from line 3 column 4.)")
  })

  it("最后一行超出时夹到文件末尾", async () => {
    const got = await actual(content, { line: 4, column: 999, limit: 10, scroll: "down" })

    expect(got).toBe("(Omitted before line 4 column 4.)\n\n")
  })

  it("向上回读时锚点同样夹在行末", async () => {
    const far = await actual(content, { line: 2, column: 999, limit: 5, scroll: "up" })
    const edge = await actual(content, { line: 2, column: 4, limit: 5, scroll: "up" })

    expect(far).toBe(edge)
    expect(far).toContain("BBB")
  })

  it("空行上的大 column 不会跑到下一行", async () => {
    const got = await actual("A\n\nB\n", { line: 2, column: 99, limit: 4, scroll: "down" })

    expect(got).toBe("(Omitted before line 2.)\n\nB\n")
  })
})

describe("窗口边缘正好压在 1MB 分块边界上", () => {
  const CHUNK = 1 << 20
  const filler = "0123456789abcdefghijklmnopqrstuvwxyz".repeat(64)
  const body = (chars: number) => {
    let out = ""
    while (out.length < chars) out += filler + "\n"
    return out.slice(0, chars)
  }

  for (const delta of [-2, -1, 0, 1, 2]) {
    it(`锚点在边界 ${delta >= 0 ? "+" : ""}${delta}`, async () => {
      const content = body(CHUNK * 2 + 500)
      const params: Params = { line: 1, column: CHUNK + delta, limit: 80, scroll: "down" }

      expect(await actual(content, params)).toBe(reference(content, params))
    }, 120_000)
  }

  for (const delta of [-1, 0, 1]) {
    it(`窗口末端在边界 ${delta >= 0 ? "+" : ""}${delta}`, async () => {
      const content = body(CHUNK * 2 + 500)
      const params: Params = { line: 1, column: CHUNK + delta - 60, limit: 60, scroll: "down" }

      expect(await actual(content, params)).toBe(reference(content, params))
    }, 120_000)
  }

  it("换行正好被分块切在 CR 与 LF 之间", async () => {
    const head = "x".repeat(CHUNK - 1)
    const content = `${head}\r\n${"tail line\r\n".repeat(20)}`
    const params: Params = { line: 2, column: 1, limit: 60, scroll: "down" }

    expect(await actual(content, params)).toBe(reference(content, params))
  }, 120_000)

  it("向上回读且锚点压在边界上", async () => {
    const content = body(CHUNK * 2 + 500)
    const params: Params = { line: 1, column: CHUNK, limit: 100, scroll: "up" }

    expect(await actual(content, params)).toBe(reference(content, params))
  }, 120_000)
})

describe("跨 chunk 边界", () => {
  it("行跨越 1MB 分块边界时仍然一致", async () => {
    const content = "head\n" + "q".repeat(2_500_000) + "\ntail\n"
    const params: Params = { line: 2, column: 1_200_000, limit: 50, scroll: "down" }

    expect(await actual(content, params)).toBe(reference(content, params))
  }, 120_000)

  it("GBK 的双字节字符被分块切开也能正确解码", async () => {
    const body = Array.from(
      { length: 120_000 },
      (_, i) => `第${i}行:配置项目与说明文字 value=${i}`,
    ).join("\n")
    const text = `开头一行\n${body}\n结尾一行\n`
    const buffer = iconv.encode(text, "gbk")
    const params: Params = { line: 60_000, column: 3, limit: 200, scroll: "down" }

    expect(await actual(buffer, params)).toBe(reference(text, params))
  }, 120_000)
})

describe("末尾残缺的 UTF-8 不再静默丢尾", () => {
  it("读到不完整的多字节结尾时报错, 而不是丢掉坏字节", async () => {
    const file = path.join(root, "truncated.txt")
    writeFileSync(file, Buffer.from([0x61, 0x62, 0x63, 0xe4, 0xb8]))
    const session = freshSession()

    await expect(
      callTool(readFileTool, { file_path: file }, { sessionId: session }),
    ).rejects.toThrow()
    expect(readAtFor(session, file)).toBeUndefined()
  })
})
