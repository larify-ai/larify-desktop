import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import iconv from "iconv-lite"
import { writeFileTool } from "../../../../src/extensions/fs/main/write"
import { markRead, withFileLock } from "../../../../src/extensions/fs/main/state"
import { callTool, freshSession } from "./harness"

interface DiffResult {
  kind: "diff"
  path: string
  patch: string
  summary: string
}

let baseDir: string
let seq = 0

// A unique on-disk path per test so files never collide across tests.
const uniquePath = (name = "file.txt"): string => join(baseDir, `${++seq}-${name}`)

// Record a read of an absolute path in a session, keyed by the RESOLVED abs path.
function seedRead(session: string, absPath: string): void {
  markRead(session, absPath, statSync(absPath).mtimeMs)
}

const write = (input: Record<string, unknown>, ctx: Parameters<typeof callTool>[2] = {}) =>
  callTool<DiffResult>(writeFileTool, input, ctx)

const modelOutputOf = (result: DiffResult) =>
  (writeFileTool.toModelOutput as (o: { output: DiffResult }) => unknown)({ output: result })

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "larify-write-"))
})
afterAll(() => {
  rmSync(baseDir, { force: true, recursive: true })
})

describe("write", () => {
  it("returns the flat diff shape and toModelOutput surfaces the summary (create)", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    const result = await write({ file_path: filePath, content: "hello" }, { sessionId: session })

    expect(result).toEqual({
      kind: "diff",
      path: filePath,
      patch: expect.any(String),
      summary: `File created successfully at: ${filePath}`,
    })
    expect(result.patch).toContain("+hello")

    // The obsolete shape is gone: no content / output / metadata / type / filePath keys.
    expect(result).not.toHaveProperty("oldContent")
    expect(result).not.toHaveProperty("newContent")
    expect(result).not.toHaveProperty("output")
    expect(result).not.toHaveProperty("metadata")
    expect(result).not.toHaveProperty("type")
    expect(result).not.toHaveProperty("filePath")

    expect(modelOutputOf(result)).toEqual({ type: "text", value: result.summary })
  })

  it("creates a new file on disk with the given content", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    await write({ file_path: filePath, content: "hello" }, { sessionId: session })
    expect(readFileSync(filePath, "utf8")).toBe("hello")
  })

  it("overwrites an existing file after it has been read (update summary)", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    writeFileSync(filePath, "old")
    seedRead(session, filePath)

    const result = await write({ file_path: filePath, content: "new" }, { sessionId: session })

    expect(readFileSync(filePath, "utf8")).toBe("new")
    expect(result).toMatchObject({
      kind: "diff",
      path: filePath,
      summary: `The file ${filePath} has been updated successfully.`,
    })
    expect(result.patch).toContain("-old")
    expect(result.patch).toContain("+new")
    expect(modelOutputOf(result)).toEqual({ type: "text", value: result.summary })
  })

  it("throws when overwriting an existing file that was not read first", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    writeFileSync(filePath, "old")

    await expect(write({ file_path: filePath, content: "new" }, { sessionId: session })).rejects.toThrow(
      "Read the file before overwriting it.",
    )
    expect(readFileSync(filePath, "utf8")).toBe("old")
  })

  it("creates missing parent directories", async () => {
    const session = freshSession()
    const nestedPath = join(baseDir, `${++seq}-parent`, "deeper", "nested.txt")
    const result = await write({ file_path: nestedPath, content: "nested" }, { sessionId: session })
    expect(existsSync(nestedPath)).toBe(true)
    expect(readFileSync(nestedPath, "utf8")).toBe("nested")
    expect(result.summary).toBe(`File created successfully at: ${nestedPath}`)
  })

  it("throws 'modified since read' when the file changed after being read", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    writeFileSync(filePath, "original")
    seedRead(session, filePath)

    // Bump the file's mtime forward so it looks modified since the read.
    const future = new Date(Date.now() + 10_000)
    utimesSync(filePath, future, future)

    await expect(write({ file_path: filePath, content: "changed" }, { sessionId: session })).rejects.toThrow(
      "The file was modified since you read it.",
    )
    // The write never happened.
    expect(readFileSync(filePath, "utf8")).toBe("original")
  })

  it("always writes utf8 bytes when creating a file with non-ASCII content", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    const cn = "你好世界"
    await write({ file_path: filePath, content: cn }, { sessionId: session })

    const onDisk = readFileSync(filePath)
    expect(onDisk.equals(Buffer.from(cn, "utf8"))).toBe(true)
    expect(readFileSync(filePath, "utf8")).toBe(cn)
  })

  it("writes utf8 (not GBK) when overwriting an existing GBK-encoded file", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    const oldCn = "你好世界，这是一个用于验证编码检测的测试文件内容。"
    const newCn = "再见，世界。"

    // Seed the file as GBK/GB18030 on disk.
    writeFileSync(filePath, iconv.encode(oldCn, "gbk"))
    seedRead(session, filePath)

    const result = await write({ file_path: filePath, content: newCn }, { sessionId: session })

    const onDisk = readFileSync(filePath)
    // The new bytes are utf8, never GBK.
    expect(onDisk.equals(Buffer.from(newCn, "utf8"))).toBe(true)
    expect(onDisk.equals(iconv.encode(newCn, "gbk"))).toBe(false)
    // The old content was decoded from GBK before diffing, so the patch names it.
    expect(result.patch).toContain(oldCn)
    expect(result.patch).toContain(newCn)
  })

  it("resolves a relative file_path against ctx.cwd and keys fileState by the resolved abs path", async () => {
    const session = freshSession()
    const relName = `${++seq}-relative.txt`
    const resolvedAbs = resolve(baseDir, relName)
    writeFileSync(resolvedAbs, "old")

    // Mark-read using the RESOLVED absolute path; the gate must accept the relative write.
    seedRead(session, resolvedAbs)

    const result = await write(
      { file_path: relName, content: "new" },
      { sessionId: session, cwd: baseDir },
    )

    expect(result.path).toBe(resolvedAbs)
    expect(readFileSync(resolvedAbs, "utf8")).toBe("new")
  })

  it("refreshes fileState after a write so a second write needs no re-read", async () => {
    const session = freshSession()
    const filePath = uniquePath()

    // First write creates the file (no fileState entry needed).
    await write({ file_path: filePath, content: "first" }, { sessionId: session })
    // Second write in the same session succeeds without re-reading.
    const second = await write({ file_path: filePath, content: "second" }, { sessionId: session })

    expect(readFileSync(filePath, "utf8")).toBe("second")
    expect(second.patch).toContain("-first")
    expect(second.patch).toContain("+second")
    expect(second.summary).toBe(`The file ${filePath} has been updated successfully.`)
  })

  it("rejects an overwrite whose content is identical to the current file", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    writeFileSync(filePath, "same")
    seedRead(session, filePath)

    await expect(
      write({ file_path: filePath, content: "same" }, { sessionId: session }),
    ).rejects.toThrow("The content is identical to the current file. Nothing to write.")
  })

  it("treats a same-content write differing only in line endings as identical", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    writeFileSync(filePath, "a\r\nb\r\n")
    seedRead(session, filePath)

    await expect(
      write({ file_path: filePath, content: "a\nb\n" }, { sessionId: session }),
    ).rejects.toThrow("identical")
  })

  it("creates a zero-byte file for empty content", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    const result = await write({ file_path: filePath, content: "" }, { sessionId: session })

    expect(statSync(filePath).size).toBe(0)
    expect(result.summary).toBe(`File created successfully at: ${filePath}`)
  })

  it("allows creating a missing file with no fileState entry (ENOENT skips the not-read check)", async () => {
    const session = freshSession()
    const filePath = uniquePath()
    // Fresh session, missing file: must NOT throw the not-read-first error.
    const result = await write({ file_path: filePath, content: "brand new" }, { sessionId: session })
    expect(result.summary).toBe(`File created successfully at: ${filePath}`)
    expect(readFileSync(filePath, "utf8")).toBe("brand new")
  })

  it("withFileLock serializes work sharing the same key (FIFO, no interleaving)", async () => {
    const key = uniquePath()
    const order: string[] = []
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const first = withFileLock(key, async () => {
      order.push("start-1")
      await delay(25)
      order.push("end-1")
    })
    const second = withFileLock(key, async () => {
      order.push("start-2")
      order.push("end-2")
    })
    await Promise.all([first, second])

    // The second critical section only runs after the first fully completes.
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"])
  })

  it("serializes concurrent writes to the same path without corruption", async () => {
    const session = freshSession()
    const filePath = uniquePath()

    const [a, b] = await Promise.all([
      write({ file_path: filePath, content: "first" }, { sessionId: session }),
      write({ file_path: filePath, content: "second" }, { sessionId: session }),
    ])

    // Both resolved (serialized, not racing), and the on-disk content is one of them intact.
    expect(a.summary).toContain(filePath)
    expect(b.summary).toContain(filePath)
    expect(["first", "second"]).toContain(readFileSync(filePath, "utf8"))
  })
})
