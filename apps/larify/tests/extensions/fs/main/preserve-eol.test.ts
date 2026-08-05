import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { editFileTool } from "../../../../src/extensions/fs/main/edit"
import { readFileTool } from "../../../../src/extensions/fs/main/read"
import { writeFileTool } from "../../../../src/extensions/fs/main/write"
import { callTool, freshSession } from "./harness"

let root: string
let session: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-preserve-eol-"))
  session = freshSession()
})

afterAll(() => rmSync(root, { force: true, recursive: true }))

const seed = (name: string, content: string): string => {
  const file = path.join(root, name)
  writeFileSync(file, content)
  return file
}

const read = (file: string) => callTool<string>(readFileTool, { file_path: file }, { sessionId: session })
const edit = (file: string, input: Record<string, unknown>) =>
  callTool(editFileTool, { file_path: file, ...input }, { sessionId: session })
const write = (file: string, content: string) =>
  callTool(writeFileTool, { file_path: file, content }, { sessionId: session })
const bytes = (file: string) => readFileSync(file, "utf8")

describe("哪种换行算主导", () => {
  const cases: Array<[string, string, string]> = [
    ["纯 LF 不被塞入 CR", "a\nTARGET\nb\n", "a\nCHANGED\nb\n"],
    ["LF 占多数时保持 LF", "a\nb\nc\nTARGET\nd\r\n", "a\nb\nc\nCHANGED\nd\n"],
    ["CRLF 占多数时保持 CRLF", "a\r\nb\r\nc\r\nTARGET\nd\r\n", "a\r\nb\r\nc\r\nCHANGED\r\nd\r\n"],
    ["各一半时归 LF", "a\r\nTARGET\nb", "a\nCHANGED\nb"],
    ["整个文件没有换行", "只有 TARGET 一行", "只有 CHANGED 一行"],
    ["纯 CR 的老 Mac 文件会被转成 LF", "a\rTARGET\rb\r", "a\nCHANGED\nb\n"],
  ]

  for (const [name, before, after] of cases) {
    it(name, async () => {
      const file = seed("a.txt", before)
      await read(file)
      await edit(file, { old_string: "TARGET", new_string: "CHANGED" })
      expect(bytes(file)).toBe(after)
    })
  }
})

describe("插入的新内容跟随文件的换行", () => {
  it("new_string 里的换行被改写成 CRLF", async () => {
    const file = seed("b.txt", "head\r\nTARGET\r\ntail\r\n")
    await read(file)

    await edit(file, { old_string: "TARGET", new_string: "one\ntwo\nthree" })

    expect(bytes(file)).toBe("head\r\none\r\ntwo\r\nthree\r\ntail\r\n")
  })

  it("跨行的 old_string 在 CRLF 文件里也能替换", async () => {
    const file = seed("c.txt", "k1\r\nm1\r\nm2\r\nk2\r\n")
    await read(file)

    await edit(file, { old_string: "m1\nm2", new_string: "M" })

    expect(bytes(file)).toBe("k1\r\nM\r\nk2\r\n")
  })

  it("replace_all 命中多处时全部保持 CRLF", async () => {
    const file = seed("d.txt", "T\r\nx\r\nT\r\ny\r\nT\r\n")
    await read(file)

    await edit(file, { old_string: "T", new_string: "Z", replace_all: true })

    expect(bytes(file)).toBe("Z\r\nx\r\nZ\r\ny\r\nZ\r\n")
  })
})

describe("文件末尾", () => {
  it("原本没有结尾换行就不补一个", async () => {
    const file = seed("e.txt", "a\r\nTARGET")
    await read(file)

    await edit(file, { old_string: "TARGET", new_string: "CHANGED" })

    expect(bytes(file)).toBe("a\r\nCHANGED")
  })

  it("原本有结尾换行就保留", async () => {
    const file = seed("f.txt", "a\r\nTARGET\r\n")
    await read(file)

    await edit(file, { old_string: "TARGET", new_string: "CHANGED" })

    expect(bytes(file)).toBe("a\r\nCHANGED\r\n")
  })
})

describe("write 覆盖", () => {
  it("覆盖 CRLF 文件时沿用 CRLF", async () => {
    const file = seed("g.txt", "old1\r\nold2\r\n")
    await read(file)

    await write(file, "new1\nnew2\n")

    expect(bytes(file)).toBe("new1\r\nnew2\r\n")
  })

  it("覆盖 LF 文件时不引入 CR", async () => {
    const file = seed("h.txt", "old1\nold2\n")
    await read(file)

    await write(file, "new1\r\nnew2\r\n")

    expect(bytes(file)).toBe("new1\nnew2\n")
  })

  it("新建文件一律用 LF", async () => {
    const file = path.join(root, "i.txt")

    await write(file, "a\r\nb\r\n")

    expect(bytes(file)).toBe("a\nb\n")
  })
})

describe("带 BOM 的文件", () => {
  it("edit 之后 BOM 和 CRLF 都还在", async () => {
    const file = seed("j.txt", "﻿a\r\nTARGET\r\nb\r\n")
    await read(file)

    await edit(file, { old_string: "TARGET", new_string: "CHANGED" })

    expect(bytes(file)).toBe("﻿a\r\nCHANGED\r\nb\r\n")
  })
})
