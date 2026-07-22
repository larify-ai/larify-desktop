import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  runRipgrep,
  runRipgrepLimited,
  runRipgrepStream,
  toAbsolutePath,
} from "../../../../src/extensions/file/main/ripgrep"

// NOTE: the ripgrep functions are context-free (no sessionId / cwd), so these
// tests call them directly and deliberately do NOT use the file-tool harness.

const tempDirs: string[] = []

async function makeTempDir(prefix = "larify-ripgrep-"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(root)
  return root
}

async function makeFixture(): Promise<string> {
  const root = await makeTempDir()
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "a.ts"), "alpha\nneedle\n")
  await writeFile(path.join(root, "src", "b.ts"), "beta\n")
  await writeFile(path.join(root, "README.md"), "needle in markdown\n")
  return root
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("runRipgrep", () => {
  // --- migrated existing cases ---

  it("runs rg --files and returns file paths as lines", async () => {
    const root = await makeFixture()

    const result = await runRipgrep(["--files", "--glob", "*.md"], root)

    expect(result).toEqual([path.join(root, "README.md")])
  })

  it("runs rg content search and returns matching lines", async () => {
    const root = await makeFixture()

    const result = await runRipgrep(["-n", "needle"], root)

    expect(result).toEqual(
      expect.arrayContaining([
        `${path.join(root, "src", "a.ts")}:2:needle`,
        `${path.join(root, "README.md")}:1:needle in markdown`,
      ]),
    )
  })

  it("returns an empty array when rg finds no matches", async () => {
    const root = await makeFixture()

    await expect(runRipgrep(["missing"], root)).resolves.toEqual([])
  })

  it("streams results with offset and limit", async () => {
    const root = await makeFixture()

    const result = await runRipgrepLimited(["--files"], root, { offset: 1, limit: 1 })

    expect(result.lines).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it("rejects ripgrep errors", async () => {
    const root = await makeFixture()

    await expect(runRipgrep(["["], root)).rejects.toThrow()
  })

  // --- BUG5: reject message includes the stderr reason, not just the exit code ---

  it("surfaces the ripgrep stderr reason in the rejection (regex parse error)", async () => {
    const root = await makeFixture()

    await expect(runRipgrep(["["], root)).rejects.toThrow(/regex parse error/)
  })

  it("surfaces the stderr reason for an invalid repetition quantifier too", async () => {
    const root = await makeFixture()

    // Whatever the exact rg wording, the reason (not only the exit code) must survive.
    await expect(runRipgrep(["a{2,1}"], root)).rejects.toThrow(/regex parse error/)
  })
})

describe("runRipgrepStream", () => {
  // --- abort handling ---

  it("resolves immediately and never emits lines when the signal is already aborted", async () => {
    const root = await makeFixture()
    const controller = new AbortController()
    controller.abort()

    let onLinesCalls = 0
    await expect(
      runRipgrepStream(["-n", "needle"], root, controller.signal, root, () => {
        onLinesCalls += 1
      }),
    ).resolves.toBeUndefined()

    expect(onLinesCalls).toBe(0)
  })

  // --- remainder flush on close: last line without a trailing newline is not dropped ---

  it("returns a match on the final line even when the source file has no trailing newline", async () => {
    const root = await makeFixture()
    // No trailing "\n" — the last (and only) line lacks an EOL in the source.
    await writeFile(path.join(root, "tail.ts"), "lastmarker")

    const lines: string[] = []
    await runRipgrepStream(["-n", "lastmarker"], root, new AbortController().signal, root, (chunk) => {
      lines.push(...chunk)
    })

    expect(lines).toContain(`${path.join(root, "tail.ts")}:1:lastmarker`)
  })
})

describe("runRipgrepLimited", () => {
  // --- external abort via options.signal ---

  it("returns empty + truncated promptly when options.signal is already aborted", async () => {
    const root = await makeFixture()
    const controller = new AbortController()
    controller.abort()

    const result = await runRipgrepLimited(["-n", "needle"], root, { signal: controller.signal })

    expect(result.lines).toEqual([])
    expect(result.truncated).toBe(true)
  })

  // --- offset only (no limit): skip N lines, return the remainder, not truncated ---

  it("skips offset lines and returns the remainder with truncated=false when no limit is set", async () => {
    const root = await makeFixture()

    const all = await runRipgrep(["--files"], root)
    expect(all.length).toBeGreaterThan(1)

    const result = await runRipgrepLimited(["--files"], root, { offset: 1 })

    expect(result.lines).toHaveLength(all.length - 1)
    expect(result.truncated).toBe(false)
  })

  // --- nonzero exit AFTER lines emitted and not aborted: error swallowed, partial lines kept ---

  it("swallows a nonzero exit and keeps partial lines when matches were already emitted", async () => {
    const root = await makeFixture()
    // A nonexistent extra path makes rg exit with code 2, but it still prints the
    // matches it found under `root` first. Since lines were emitted and we never
    // aborted, the error must be swallowed and the partial lines returned.
    const missingPath = path.join(root, "__does_not_exist__")

    const result = await runRipgrepLimited(["-n", "needle", missingPath], root)

    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.lines).toEqual(
      expect.arrayContaining([`${path.join(root, "src", "a.ts")}:2:needle`]),
    )
    expect(result.truncated).toBe(false)
  })

  it("rethrows a nonzero exit when no lines were emitted and not aborted", async () => {
    const root = await makeFixture()
    const missingPath = path.join(root, "__does_not_exist__")

    // Pattern that matches nothing -> no lines emitted -> error is NOT swallowed.
    await expect(runRipgrepLimited(["-n", "nosuchtoken", missingPath], root)).rejects.toThrow()
  })
})

describe("toAbsolutePath", () => {
  it("returns an absolute input unchanged", () => {
    const base = path.join("some", "base")
    const absolute = path.resolve("x", "y", "z.ts")

    expect(toAbsolutePath(base, absolute)).toBe(absolute)
  })

  it("joins a relative input onto the base path", () => {
    const base = path.resolve("project", "root")
    const relative = path.join("nested", "file.ts")

    expect(toAbsolutePath(base, relative)).toBe(path.join(base, relative))
  })
})

describe("multibyte / CJK content (BUG2)", () => {
  it("decodes CJK match lines correctly instead of emitting replacement chars", async () => {
    const root = await makeTempDir("larify-ripgrep-cjk-")
    await writeFile(path.join(root, "cjk.txt"), "第一行\nCJK配置项测试\n最后一行\n")

    const result = await runRipgrep(["-n", "配置项"], root)

    expect(result).toEqual([`${path.join(root, "cjk.txt")}:2:CJK配置项测试`])
    expect(result.join("")).not.toContain("�")
  })

  it("keeps CJK intact across stdout chunk boundaries for a large file", async () => {
    const root = await makeTempDir("larify-ripgrep-cjk-big-")
    // >128 KiB of 3-byte CJK chars so many characters straddle 64 KiB pipe reads;
    // StringDecoder must stitch the split UTF-8 sequences back together.
    const count = 5000
    let content = ""
    for (let i = 0; i < count; i += 1) content += `行${i}配置项测试内容\n`
    const file = path.join(root, "big.txt")
    await writeFile(file, content)

    const result = await runRipgrep(["-n", "配置项"], root)

    expect(result).toHaveLength(count)
    expect(result.every((line) => !line.includes("�"))).toBe(true)
    expect(result[0]).toBe(`${file}:1:行0配置项测试内容`)
    expect(result[count - 1]).toBe(`${file}:${count}:行${count - 1}配置项测试内容`)
  })
})
