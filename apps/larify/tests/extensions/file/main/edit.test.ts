import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import iconv from "iconv-lite"
import { editFileTool } from "../../../../src/extensions/file/main/edit"
import { markRead } from "../../../../src/extensions/file/main/state"
import { callTool, freshSession } from "./harness"

// Mark a file as "read" for a session, using the RESOLVED ABSOLUTE path as the
// staleness key (mirrors what read.ts does: floor(mtimeMs) at read time).
function seedRead(session: string, absPath: string): void {
  markRead(session, absPath, statSync(absPath).mtimeMs)
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "larify-edit-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("edit — migrated core cases", () => {
  it("replaces a unique match", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello world")
    seedRead(session, abs)

    await callTool(editFileTool, { file_path: abs, old_string: "world", new_string: "there" }, { sessionId: session })

    expect(readFileSync(abs, "utf8")).toBe("hello there")
  })

  it("edits a short UTF-8 file with a multibyte char without corrupting its bytes", async () => {
    const session = freshSession()
    const abs = join(dir, "deg.ts")
    writeFileSync(abs, "let a = 1 // °C\n", "utf8")
    seedRead(session, abs)

    await callTool(editFileTool, { file_path: abs, old_string: "a = 1", new_string: "a = 2" }, { sessionId: session })

    expect(readFileSync(abs, "utf8")).toBe("let a = 2 // °C\n")
    const bytes = readFileSync(abs)
    expect(bytes.includes(Buffer.from([0xc2, 0xb0]))).toBe(true)
    expect(bytes.includes(Buffer.from([0xc3, 0x82, 0xc2, 0xb0]))).toBe(false)
  })

  it("throws if the file was not read first", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello")
    // Deliberately NOT marked read.

    await expect(
      callTool(editFileTool, { file_path: abs, old_string: "hello", new_string: "hi" }, { sessionId: session }),
    ).rejects.toThrow("Read the file before editing it.")
  })

  it("throws if old_string is not found", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello")
    seedRead(session, abs)

    await expect(
      callTool(editFileTool, { file_path: abs, old_string: "xyz", new_string: "a" }, { sessionId: session }),
    ).rejects.toThrow("not found")
  })

  it("throws 'appears N times' if old_string is not unique", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "a a a")
    seedRead(session, abs)

    await expect(
      callTool(editFileTool, { file_path: abs, old_string: "a", new_string: "b" }, { sessionId: session }),
    ).rejects.toThrow("appears 3 times")
  })

  it("replaces all with replace_all", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "a a a")
    seedRead(session, abs)

    await callTool(
      editFileTool,
      { file_path: abs, old_string: "a", new_string: "b", replace_all: true },
      { sessionId: session },
    )

    expect(readFileSync(abs, "utf8")).toBe("b b b")
  })

  it("throws if old_string and new_string are identical", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hi")
    seedRead(session, abs)

    await expect(
      callTool(editFileTool, { file_path: abs, old_string: "x", new_string: "x" }, { sessionId: session }),
    ).rejects.toThrow("identical")
  })
})

describe("edit — return shape & toModelOutput", () => {
  it("returns the flat diff shape and nothing else", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello world")
    seedRead(session, abs)

    const result = await callTool<{
      kind: string
      path: string
      patch: string
      oldContent: string
      newContent: string
      summary: string
    }>(editFileTool, { file_path: abs, old_string: "world", new_string: "there" }, { sessionId: session })

    expect(Object.keys(result).sort()).toEqual(["kind", "newContent", "oldContent", "patch", "path", "summary"])
    expect(result.kind).toBe("diff")
    expect(result.path).toBe(abs)
    expect(result.oldContent).toBe("hello world")
    expect(result.newContent).toBe("hello there")
    expect(result.summary).toBe(`Edited ${abs}.`)
    expect(typeof result.patch).toBe("string")

    // The OLD shape must be gone.
    expect(result).not.toHaveProperty("output")
    expect(result).not.toHaveProperty("metadata")
    expect(result).not.toHaveProperty("filePath")
    expect(result).not.toHaveProperty("type")
  })

  it("toModelOutput projects to a text value of the summary", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello world")
    seedRead(session, abs)

    const result = await callTool<{ summary: string }>(
      editFileTool,
      { file_path: abs, old_string: "world", new_string: "there" },
      { sessionId: session },
    )

    const projected = editFileTool.toModelOutput!({ output: result } as never)
    expect(projected).toEqual({ type: "text", value: result.summary })
    expect(projected).toEqual({ type: "text", value: `Edited ${abs}.` })
  })
})

describe("edit — summary & patch text", () => {
  it("uses a plain summary for a single replacement, with old/new hunk lines", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello world")
    seedRead(session, abs)

    const result = await callTool<{ summary: string; patch: string }>(
      editFileTool,
      { file_path: abs, old_string: "hello world", new_string: "hello there" },
      { sessionId: session },
    )

    expect(result.summary).toBe(`Edited ${abs}.`)
    expect(result.patch).toContain("-hello world")
    expect(result.patch).toContain("+hello there")
  })

  it("counts replacements in the summary for replace_all", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "a a a")
    seedRead(session, abs)

    const result = await callTool<{ summary: string; patch: string }>(
      editFileTool,
      { file_path: abs, old_string: "a", new_string: "b", replace_all: true },
      { sessionId: session },
    )

    expect(result.summary).toBe(`Edited ${abs} (3 replacements).`)
    expect(result.patch).toContain("-a a a")
    expect(result.patch).toContain("+b b b")
  })
})

describe("edit — staleness gate", () => {
  it("rejects when the file was modified since read", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello world")
    seedRead(session, abs)

    // Bump the mtime to well after the recorded read time.
    const future = new Date(Date.now() + 100_000)
    utimesSync(abs, future, future)

    await expect(
      callTool(editFileTool, { file_path: abs, old_string: "world", new_string: "there" }, { sessionId: session }),
    ).rejects.toThrow("The file was modified since you read it.")
  })

  it("refreshes fileState after editing so two sequential edits both succeed", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "one two")
    seedRead(session, abs)

    await callTool(editFileTool, { file_path: abs, old_string: "one", new_string: "ONE" }, { sessionId: session })
    // No intervening re-read: the tool must have refreshed fileState itself.
    await callTool(editFileTool, { file_path: abs, old_string: "two", new_string: "TWO" }, { sessionId: session })

    expect(readFileSync(abs, "utf8")).toBe("ONE TWO")
  })
})

describe("edit — path resolution via cwd", () => {
  it("resolves a relative file_path against cwd; staleness key is the resolved abs path", async () => {
    const session = freshSession()
    const abs = join(dir, "rel.txt")
    writeFileSync(abs, "hello world")
    // Mark read using the RESOLVED ABSOLUTE path.
    seedRead(session, abs)

    // Edit with a RELATIVE file_path + cwd; must pass the read gate.
    const result = await callTool<{ path: string }>(
      editFileTool,
      { file_path: "rel.txt", old_string: "world", new_string: "there" },
      { sessionId: session, cwd: dir },
    )

    expect(result.path).toBe(abs)
    expect(readFileSync(abs, "utf8")).toBe("hello there")
  })
})

describe("edit — encoding", () => {
  it("reads a GBK file correctly and writes it back as utf8", async () => {
    const session = freshSession()
    const abs = join(dir, "gbk.txt")
    const original = "这是一个用于测试的中文文件内容，包含若干汉字。修改这里的文本以验证编码处理是否正确。"
    // Write the fixture as GBK bytes.
    writeFileSync(abs, iconv.encode(original, "gbk"))
    seedRead(session, abs)

    const oldStr = "修改这里的文本以验证"
    const newStr = "REPLACED这里"
    const updated = original.split(oldStr).join(newStr)

    const result = await callTool<{ oldContent: string; newContent: string }>(
      editFileTool,
      { file_path: abs, old_string: oldStr, new_string: newStr },
      { sessionId: session },
    )

    // The GBK bytes were decoded to the correct Chinese text before matching.
    expect(result.oldContent).toBe(original)
    expect(result.newContent).toBe(updated)

    // The file is now written as UTF-8, regardless of the original GBK encoding.
    const raw = readFileSync(abs)
    expect(raw.toString("utf8")).toBe(updated)
    expect(Buffer.compare(raw, Buffer.from(updated, "utf8"))).toBe(0)
  })
})

describe("edit — literal (not regex) matching", () => {
  it("treats '.' literally — a would-be regex wildcard does not match arbitrary chars", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "aXc")
    seedRead(session, abs)

    // As a regex, "a.c" would match "aXc"; as a literal it does not.
    await expect(
      callTool(editFileTool, { file_path: abs, old_string: "a.c", new_string: "Z" }, { sessionId: session }),
    ).rejects.toThrow("not found")

    // And a literal "a.c" matches only a literal "a.c".
    writeFileSync(abs, "a.c here")
    seedRead(session, abs)
    await callTool(editFileTool, { file_path: abs, old_string: "a.c", new_string: "Z" }, { sessionId: session })
    expect(readFileSync(abs, "utf8")).toBe("Z here")
  })

  it("treats '$1' and '[...]' as literal text", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "price is $1 and arr[0] value")
    seedRead(session, abs)

    await callTool(
      editFileTool,
      { file_path: abs, old_string: "$1", new_string: "$2" },
      { sessionId: session },
    )
    // $2 in the replacement stays literal (not a backreference).
    expect(readFileSync(abs, "utf8")).toBe("price is $2 and arr[0] value")

    seedRead(session, abs)
    await callTool(
      editFileTool,
      { file_path: abs, old_string: "[0]", new_string: "[1]" },
      { sessionId: session },
    )
    expect(readFileSync(abs, "utf8")).toBe("price is $2 and arr[1] value")
  })
})

describe("edit — deletion & multi-line", () => {
  it("deletes old_string when new_string is empty", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "hello world")
    seedRead(session, abs)

    await callTool(editFileTool, { file_path: abs, old_string: "world", new_string: "" }, { sessionId: session })

    expect(readFileSync(abs, "utf8")).toBe("hello ")
  })

  it("replaces a multi-line old_string spanning lines", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "line1\nline2\nline3")
    seedRead(session, abs)

    await callTool(
      editFileTool,
      { file_path: abs, old_string: "line1\nline2", new_string: "X" },
      { sessionId: session },
    )

    expect(readFileSync(abs, "utf8")).toBe("X\nline3")
  })
})

describe("edit — concurrency", () => {
  it("serializes concurrent edits to the same path (no lost update)", async () => {
    const session = freshSession()
    const abs = join(dir, "file.txt")
    writeFileSync(abs, "AAA BBB")
    seedRead(session, abs)

    // Fire both without awaiting between them; withFileLock must serialize them
    // so neither edit clobbers the other's write.
    const p1 = callTool(editFileTool, { file_path: abs, old_string: "AAA", new_string: "XXX" }, { sessionId: session })
    const p2 = callTool(editFileTool, { file_path: abs, old_string: "BBB", new_string: "YYY" }, { sessionId: session })
    await Promise.all([p1, p2])

    expect(readFileSync(abs, "utf8")).toBe("XXX YYY")
  })
})
