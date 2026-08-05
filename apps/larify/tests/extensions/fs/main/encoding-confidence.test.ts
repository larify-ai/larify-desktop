import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { decodeText } from "../../../../src/extensions/fs/main/encoding"
import { grepFilesTool } from "../../../../src/extensions/fs/main/grep"
import { readFileTool } from "../../../../src/extensions/fs/main/read"
import { callTool, freshSession } from "./harness"

let root: string
let session: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-encoding-"))
  session = freshSession()
})

afterAll(() => rmSync(root, { force: true, recursive: true }))

const readFile = (name: string, content: Buffer) => {
  const file = path.join(root, name)
  writeFileSync(file, content)
  return callTool<string>(readFileTool, { file_path: file }, { sessionId: session })
}

const many = (line: string, count: number) =>
  Array.from({ length: count }, (_, i) => line.replace("%d", String(i))).join("\n")

describe("认得出的编码照常解码", () => {
  const cases: Array<[string, string, string]> = [
    ["GBK", "第%d行的中文内容测试", "gbk"],
    ["Big5", "第%d行的中文內容測試", "big5"],
    ["Shift_JIS", "%d行目の日本語テキスト", "shift_jis"],
    ["EUC-KR", "%d번째 줄 한국어 텍스트", "euc-kr"],
  ]

  for (const [name, line, encoding] of cases) {
    it(`${name} 解出原文`, async () => {
      const text = many(line, 10)
      const shown = await readFile(`${encoding}.txt`, iconv.encode(text, encoding))
      expect(shown).toContain(line.replace("%d", "3"))
    })
  }
})

describe("认不出的编码报错而不是返回乱码", () => {
  it("过短的 GBK 片段被拒绝", async () => {
    const tiny = iconv.encode("目标", "gbk")

    await expect(readFile("tiny.txt", tiny)).rejects.toThrow("Not UTF-8; encoding undetermined")
  })

  it("KOI8-R 即使内容够长也被拒绝", async () => {
    const text = many("строка %d русский текст", 50)

    await expect(readFile("koi8.txt", iconv.encode(text, "koi8-r"))).rejects.toThrow(
      "Not UTF-8; encoding undetermined",
    )
  })

  it("错误信息带上猜测和置信度", () => {
    expect(() => decodeText(iconv.encode("目标", "gbk"))).toThrow(/best guess \w+, confidence \d+/)
  })

  it("拒绝的是猜测而不是内容, 长 GBK 仍然通过", () => {
    const text = many("第%d行的中文内容测试", 10)

    expect(decodeText(iconv.encode(text, "gbk"))).toBe(text)
  })
})

describe("grep 认不出编码时退到有损解码而不是丢掉整行", () => {
  it("匹配行里的 ASCII 部分仍然可见", async () => {
    const dir = path.join(root, "lossy")
    mkdirSync(dir)
    const body = ["配置项 needle here", "另一行"].join("\n") + "\n"
    writeFileSync(path.join(dir, "mixed.txt"), iconv.encode(body, "gbk"))

    const output = await callTool<string>(
      grepFilesTool,
      { pattern: "needle", path: dir },
      { sessionId: session },
    )

    expect(output).toContain("needle")
  }, 120_000)
})

describe("非法字节出现在第一块之后也报同一条信息", () => {
  it("read 读到损坏处时给出和 decodeText 一致的措辞", async () => {
    const clean = Buffer.from("clean utf8 line\n".repeat(100_000), "utf8")
    const broken = Buffer.concat([clean, Buffer.from([0xff, 0xfe, 0xff, 0xfe]), Buffer.from("\ntail\n")])
    const file = path.join(root, "broken.txt")
    writeFileSync(file, broken)

    await expect(
      callTool(readFileTool, { file_path: file, line: 99_999 }, { sessionId: session }),
    ).rejects.toThrow(/^Not UTF-8; encoding undetermined \(best guess .+, confidence \d+\)\.$/)
    expect(() => decodeText(broken)).toThrow(/^Not UTF-8; encoding undetermined/)
  }, 120_000)

  it("损坏之前的部分仍然读得出来", async () => {
    const clean = Buffer.from("clean utf8 line\n".repeat(100_000), "utf8")
    const broken = Buffer.concat([clean, Buffer.from([0xff, 0xfe]), Buffer.from("\ntail\n")])
    const file = path.join(root, "broken2.txt")
    writeFileSync(file, broken)

    const shown = await callTool<string>(
      readFileTool,
      { file_path: file, line: 1, limit: 40 },
      { sessionId: session },
    )

    expect(shown).toContain("clean utf8 line")
  }, 120_000)
})

describe("UTF-8 路径不受影响", () => {
  it("普通 UTF-8 直接解码", async () => {
    const shown = await readFile("utf8.txt", Buffer.from("中文 hello\n", "utf8"))

    expect(shown).toContain("中文 hello")
  })

  it("带 BOM 的 UTF-8 保留 BOM", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("abc", "utf8")])

    expect(decodeText(withBom)).toBe("﻿abc")
  })

  it("空文件解成空串", () => {
    expect(decodeText(Buffer.alloc(0))).toBe("")
  })
})
