import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { lsTool } from "../../../../src/extensions/fs/main/ls"
import { callTool, freshSession } from "./harness"

const tempDirs: string[] = []

// 4-item fixture: components/, extensions/, main.ts, preload.ts
async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-ls-"))
  tempDirs.push(root)
  await mkdir(path.join(root, "components"))
  await mkdir(path.join(root, "extensions"))
  await writeFile(path.join(root, "main.ts"), "main")
  await writeFile(path.join(root, "preload.ts"), "preload")
  return root
}

async function makeEmptyDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-ls-empty-"))
  tempDirs.push(root)
  return root
}

async function makeManyFilesDir(count: number): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-ls-many-"))
  tempDirs.push(root)
  await Promise.all(
    Array.from({ length: count }, (_unused, i) =>
      writeFile(path.join(root, `file${String(i).padStart(4, "0")}.txt`), "x"),
    ),
  )
  return root
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("ls", () => {
  // 1. Migrated: lists items with trailing / on dirs.
  it("lists directory items with trailing slash on directories", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    expect(result.split("\n")).toEqual(
      expect.arrayContaining(["components/", "extensions/", "main.ts", "preload.ts"]),
    )
    // Dirs get a trailing slash; files do not.
    expect(result).toContain("components/")
    expect(result).not.toContain("main.ts/")
  })

  // 2. Omitted path uses ctx.cwd.
  it("uses the session cwd when path is omitted", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(lsTool, {}, { sessionId: freshSession(), cwd: root })

    expect(result).toContain("components/")
    expect(result).toContain("main.ts")
  })

  // 3. Defaults applied: no limit/offset lists ALL items (zod defaults 200/0 via harness parse).
  it("applies zod defaults so a small dir lists every item with no notes", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    const lines = result.split("\n")
    expect(lines).toHaveLength(4)
    expect(lines).toEqual(expect.arrayContaining(["components/", "extensions/", "main.ts", "preload.ts"]))
    expect(result).not.toContain("omitted")
  })

  // 1. Migrated: paginated shows both notes.
  it("shows omitted item ranges on both ends when paginated", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(
      lsTool,
      { path: root, limit: 2, offset: 1 },
      { sessionId: freshSession() },
    )

    expect(result).toMatch(/^\(Items 1-1 omitted\.\)\n/)
    expect(result).toMatch(/\n\(Items 4-4 omitted\.\)$/)
  })

  // 4. Directory with >200 entries truncates with a trailing "(Items 201-<total> omitted.)" note.
  it("truncates a directory with more than 200 entries and appends the tail note", async () => {
    const root = await makeManyFilesDir(250)

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    const lines = result.split("\n")
    // 200 items + 1 trailing note line, no leading note (offset 0).
    expect(lines).toHaveLength(201)
    expect(result).not.toMatch(/^\(Items 1-/)
    expect(result).toMatch(/\n\(Items 201-250 omitted\.\)$/)
  })

  // 5. offset>0 with end===items.length -> ONLY the top omission note (no bottom).
  it("emits only the leading note when the page reaches the end of the list", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(
      lsTool,
      { path: root, offset: 1 },
      { sessionId: freshSession() },
    )

    // Leading note present, no trailing note.
    expect(result).toMatch(/^\(Items 1-1 omitted\.\)\n/)
    expect((result.match(/omitted/g) ?? [])).toHaveLength(1)
    expect(result.endsWith("omitted.)")).toBe(false)
  })

  // 6. offset beyond total item count -> clear "past end" note, not a misleading "empty".
  it("reports the offset is past the end instead of looking like an empty directory", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(
      lsTool,
      { path: root, offset: 10 },
      { sessionId: freshSession() },
    )

    expect(result).not.toBe("No items found.")
    expect(result).toMatch(/past the 4 items/)
  })

  it("lists items in a stable sorted order so pagination does not repeat or skip", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    expect(result.split("\n")).toEqual(["components/", "extensions/", "main.ts", "preload.ts"])
  })

  // 7. limit exactly equal to remaining count -> no bottom note.
  it("omits the trailing note when limit exactly covers the remaining items", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(
      lsTool,
      { path: root, limit: 4, offset: 0 },
      { sessionId: freshSession() },
    )

    expect(result.split("\n")).toHaveLength(4)
    expect(result).not.toContain("omitted")
  })

  // 1. Migrated: empty directory -> "No items found."
  it("returns a clear message for an empty directory", async () => {
    const root = await makeEmptyDir()

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    expect(result).toBe("No items found.")
  })

  // 1. Migrated: not-a-directory throws.
  it("throws when the path is not a directory", async () => {
    const root = await makeFixture()
    const filePath = path.join(root, "main.ts")

    await expect(
      callTool<string>(lsTool, { path: filePath }, { sessionId: freshSession() }),
    ).rejects.toThrow("Path is not a directory")
  })

  // 8. ENOENT (nonexistent path) is returned for the model to handle.
  it("returns the ENOENT error for a nonexistent path", async () => {
    const root = await makeFixture()
    const missing = path.join(root, "does-not-exist")

    const result = await callTool<string>(lsTool, { path: missing }, { sessionId: freshSession() })

    expect(result).toMatch(/ENOENT/)
  })

  // 9. Dotfiles/hidden entries ARE included.
  it("includes dotfiles and hidden entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "larify-ls-hidden-"))
    tempDirs.push(root)
    await writeFile(path.join(root, ".hidden"), "secret")
    await mkdir(path.join(root, ".config"))
    await writeFile(path.join(root, "visible.ts"), "v")

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    const lines = result.split("\n")
    expect(lines).toEqual(expect.arrayContaining([".hidden", ".config/", "visible.ts"]))
  })
})

const dirLinkKind = process.platform === "win32" ? "junction" : "dir"

const canLink = (kind: "dir" | "junction" | "file"): boolean => {
  const probe = mkdtempSync(path.join(os.tmpdir(), "larify-ls-probe-"))
  try {
    const target = path.join(probe, "target")
    if (kind === "file") writeFileSync(target, "x")
    else mkdirSync(target)
    symlinkSync(target, path.join(probe, "link"), kind)
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { force: true, recursive: true })
  }
}

describe("ls with links", () => {
  it.skipIf(!canLink(dirLinkKind))("marks a link to a directory as a directory", async () => {
    const root = await makeFixture()
    symlinkSync(path.join(root, "components"), path.join(root, "linked"), dirLinkKind)

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    expect(result.split("\n")).toContain("linked/")
  })

  it.skipIf(!canLink(dirLinkKind))("still marks real files and directories correctly", async () => {
    const root = await makeFixture()
    symlinkSync(path.join(root, "components"), path.join(root, "linked"), dirLinkKind)

    const lines = (
      await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })
    ).split("\n")

    expect(lines).toEqual(expect.arrayContaining(["components/", "extensions/", "main.ts", "preload.ts"]))
  })

  it.skipIf(!canLink(dirLinkKind))("lists a broken link as a plain entry without throwing", async () => {
    const root = await makeFixture()
    symlinkSync(path.join(root, "missing-target"), path.join(root, "broken"), dirLinkKind)

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    expect(result.split("\n")).toContain("broken")
  })

  it.skipIf(!canLink("file"))("marks a link to a file as a file", async () => {
    const root = await makeFixture()
    symlinkSync(path.join(root, "main.ts"), path.join(root, "linked.ts"), "file")

    const result = await callTool<string>(lsTool, { path: root }, { sessionId: freshSession() })

    expect(result.split("\n")).toContain("linked.ts")
  })
})
