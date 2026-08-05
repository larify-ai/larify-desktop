import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { globFilesTool } from "../../../../src/extensions/fs/main/glob"
import { callTool } from "./harness"

const tempDirs: string[] = []

async function makeTempDir(prefix = "larify-glob-"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

// Fixture: src/a.ts, src/b.ts, README.md  (3 files total).
async function makeFixture(): Promise<string> {
  const root = await makeTempDir()
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "a.ts"), "a")
  await writeFile(path.join(root, "src", "b.ts"), "b")
  await writeFile(path.join(root, "README.md"), "readme")
  return root
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("glob", () => {
  // --- migrated cases ---

  it("finds files by glob pattern under an explicit path", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(globFilesTool, { pattern: "**/*.ts", path: root })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).not.toContain("README.md")
  })

  it("uses the session cwd when path is omitted", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(globFilesTool, { pattern: "README.md" }, { cwd: root })

    expect(result).toBe(path.join(root, "README.md"))
  })

  it("shows the omitted-results note when paginated (truncation via limit+1)", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(globFilesTool, {
      pattern: "**/*",
      path: root,
      limit: 1,
      offset: 1,
    })

    expect(result).not.toContain("Matching files 1-1 omitted")
    expect(result).toMatch(/\n\(More results omitted; use offset 2 to continue or narrow the search\.\)$/)
  })

  it("throws when path is not a directory", async () => {
    const root = await makeFixture()
    const filePath = path.join(root, "README.md")

    await expect(callTool(globFilesTool, { pattern: "**/*", path: filePath })).rejects.toThrow(
      "Path is not a directory",
    )
  })

  it("returns the ENOENT error when the path does not exist", async () => {
    const root = await makeFixture()
    const missing = path.join(root, "does-not-exist")

    const result = await callTool<string>(globFilesTool, { pattern: "**/*", path: missing })

    expect(result).toMatch(/ENOENT/)
  })

  // --- added cases ---

  it("uses ctx.cwd for the search root when path is omitted (pattern only)", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(globFilesTool, { pattern: "**/*.ts" }, { cwd: root })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).not.toContain("README.md")
  })

  it("returns \"No files found.\" when nothing matches", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(globFilesTool, { pattern: "**/*.nomatch", path: root })

    expect(result).toBe("No files found.")
  })

  it("orders results by modification time (descending: newest first)", async () => {
    const root = await makeTempDir()
    await writeFile(path.join(root, "old.ts"), "x")
    await writeFile(path.join(root, "mid.ts"), "x")
    await writeFile(path.join(root, "new.ts"), "x")
    const now = Date.now() / 1000
    await utimes(path.join(root, "old.ts"), now - 2000, now - 2000)
    await utimes(path.join(root, "mid.ts"), now - 1000, now - 1000)
    await utimes(path.join(root, "new.ts"), now, now)

    const result = await callTool<string>(globFilesTool, { pattern: "**/*.ts", path: root })
    const lines = result.split("\n")

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain(path.join(root, "new.ts"))
    expect(lines[1]).toContain(path.join(root, "mid.ts"))
    expect(lines[2]).toContain(path.join(root, "old.ts"))
  })

  it("reaches gitignored dirs because of --no-ignore (finds node_modules)", async () => {
    const root = await makeTempDir()
    await mkdir(path.join(root, "node_modules"))
    await writeFile(path.join(root, "node_modules", "pkg.js"), "x")
    await writeFile(path.join(root, ".gitignore"), "node_modules\n")

    const result = await callTool<string>(globFilesTool, { pattern: "**/*.js", path: root })

    expect(result).toContain(path.join(root, "node_modules", "pkg.js"))
  })

  it("never returns files under .git", async () => {
    const root = await makeTempDir()
    await mkdir(path.join(root, ".git"))
    await writeFile(path.join(root, ".git", "ignored.js"), "x")
    await writeFile(path.join(root, "app.js"), "x")

    const result = await callTool<string>(globFilesTool, { pattern: "**/*.js", path: root })

    expect(result).toContain(path.join(root, "app.js"))
    expect(result).not.toContain(path.join(root, ".git", "ignored.js"))
  })

  it("matches dotfiles because of --hidden (finds a .env)", async () => {
    const root = await makeTempDir()
    await writeFile(path.join(root, ".env"), "SECRET=1")
    await writeFile(path.join(root, "app.js"), "x")

    const result = await callTool<string>(globFilesTool, { pattern: ".env", path: root })

    expect(result).toBe(path.join(root, ".env"))
  })

  it("adds no omitted-results note when matches exactly equal the limit", async () => {
    const root = await makeTempDir()
    await writeFile(path.join(root, "a.ts"), "x")
    await writeFile(path.join(root, "b.ts"), "x")
    await writeFile(path.join(root, "c.ts"), "x")

    const result = await callTool<string>(globFilesTool, { pattern: "**/*.ts", path: root, limit: 3 })

    expect(result).not.toContain("More results omitted")
    expect(result.split("\n")).toHaveLength(3)
  })

  it("returns \"No files found.\" with no note when offset is beyond the total", async () => {
    const root = await makeFixture() // 3 files

    const result = await callTool<string>(globFilesTool, { pattern: "**/*", path: root, offset: 10 })

    expect(result).toBe("No files found.")
    expect(result).not.toContain("More results omitted")
  })

  it("says the search was cut short rather than claiming no files when aborted", async () => {
    const root = await makeFixture()
    const controller = new AbortController()
    controller.abort()

    const result = await callTool<string>(
      globFilesTool,
      { pattern: "**/*", path: root },
      { signal: controller.signal },
    )

    expect(result).not.toBe("No files found.")
    expect(result.includes("Search stopped") || result.includes("More results omitted")).toBe(true)
  })

  it("returns absolute paths", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(globFilesTool, { pattern: "**/*", path: root })
    const lines = result.split("\n").filter((line) => !line.startsWith("(More results"))

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(path.isAbsolute(line)).toBe(true)
    }
  })
})
