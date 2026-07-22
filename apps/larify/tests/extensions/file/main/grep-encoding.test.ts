import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { grepFilesTool } from "../../../../src/extensions/file/main/grep"
import { callTool } from "./harness"

const grep = (input: Record<string, unknown>) => callTool<string>(grepFilesTool, input)

let root: string

const comment = "// 处理超时 handleTimeout 逻辑，这里是一段足够长的中文注释用于让编码检测可靠工作。"
const source = `${comment}\n${comment}\n${comment}\nfunction handleTimeout() {}\n`

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-grep-enc-"))
  writeFileSync(path.join(root, "gbk.js"), iconv.encode(source, "gbk"))
  writeFileSync(path.join(root, "utf8.js"), source, "utf8")
})

afterAll(() => {
  rmSync(root, { force: true, recursive: true })
})

describe("grep on a non-UTF-8 file", () => {
  it("returns the non-UTF-8 matches instead of silently dropping them", async () => {
    const output = await grep({ pattern: "handleTimeout", path: path.join(root, "gbk.js") })

    expect(output).not.toContain("No matches found.")
    expect(output).toContain("1: ")
    expect(output).toContain("2: ")
    expect(output).toContain("3: ")
  })

  it("quotes the line ripgrep numbered, not a neighbouring one", async () => {
    const output = await grep({ pattern: "handleTimeout", path: path.join(root, "utf8.js") })

    for (const row of output.split("\n").filter((line) => /^\d+: /.test(line))) {
      expect(row).toContain("handleTimeout")
    }
  })

  it("decodes the matched line to the same text read would show", async () => {
    const output = await grep({ pattern: "handleTimeout", path: path.join(root, "gbk.js") })

    expect(output).toContain(comment)
    expect(output).not.toContain("´¦Àí")
  })

  it("returns the same match set as the UTF-8 copy of the file", async () => {
    const gbk = await grep({ pattern: "handleTimeout", path: path.join(root, "gbk.js") })
    const utf8 = await grep({ pattern: "handleTimeout", path: path.join(root, "utf8.js") })

    const lines = (out: string) => out.split("\n").filter((line) => /^\d+: /.test(line))
    expect(lines(gbk)).toEqual(lines(utf8))
  })

  it("still reports no matches when the pattern is genuinely absent", async () => {
    const output = await grep({ pattern: "notPresentAnywhere", path: path.join(root, "gbk.js") })

    expect(output).toBe("No matches found.")
  })
})
