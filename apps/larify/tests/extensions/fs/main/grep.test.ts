import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { globFilesTool } from "../../../../src/extensions/fs/main/glob"
import { grepFilesTool } from "../../../../src/extensions/fs/main/grep"
import * as ripgrep from "../../../../src/extensions/fs/main/ripgrep"
import { callTool } from "./harness"

const tempDirs: string[] = []

async function mkTemp(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-grep-"))
  tempDirs.push(root)
  return root
}

// Standard fixture: "foo" matches src/a.ts (2 lines), src/b.ts (1 line) and
// README.md (1 line) => three matching files.
async function makeFixture(): Promise<string> {
  const root = await mkTemp()
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "a.ts"), "alpha\nfoo one\nbeta\nfoo two\n")
  await writeFile(path.join(root, "src", "b.ts"), "foo three\nplain\n")
  await writeFile(path.join(root, "README.md"), "foo docs\n")
  await writeFile(path.join(root, "notes.txt"), "nothing\n")
  return root
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("grep", () => {
  // --- migrated cases ------------------------------------------------------

  it("groups matching lines by file", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(grepFilesTool, { pattern: "foo", path: root })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain("2: foo one")
    expect(result).toContain("4: foo two")
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).toContain("1: foo three")
  })

  it("filters files with a glob", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(grepFilesTool, {
      pattern: "foo",
      path: root,
      glob: "**/*.ts",
    })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).not.toContain("README.md")
  })

  it("uses the session cwd when path is omitted", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(grepFilesTool, { pattern: "foo docs" }, { cwd: root })

    expect(result).toBe(`${path.join(root, "README.md")}\n1: foo docs`)
  })

  it("shows omitted file ranges when paginated by file", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(grepFilesTool, {
      pattern: "foo",
      path: root,
      limit: 1,
      offset: 1,
    })

    expect(result).toMatch(new RegExp(`${escapeRegExp(root)}.*\n\\d+: foo`))
    expect(result).toMatch(
      /\n\n\(More results omitted; use offset 2 to continue or narrow the search\.\)$/,
    )
  })

  it("counts offset by file, not by matching line", async () => {
    const root = await makeFixture()

    const firstPage = await callTool<string>(grepFilesTool, {
      pattern: "foo",
      path: root,
      limit: 1,
      offset: 0,
    })
    const firstFile = firstPage.split("\n")[0]

    const secondPage = await callTool<string>(grepFilesTool, {
      pattern: "foo",
      path: root,
      limit: 1,
      offset: 1,
    })

    expect(secondPage).not.toContain(firstFile)
    expect(secondPage.match(new RegExp(escapeRegExp(root), "g"))).toHaveLength(1)
  })

  it("returns a clear message when no files match", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(grepFilesTool, { pattern: "missing", path: root })

    expect(result).toBe("No matches found.")
  })

  it("returns partial results when ripgrep fails after producing matches", async () => {
    const root = await makeFixture()
    const filePath = path.join(root, "src", "a.ts")
    vi.spyOn(ripgrep, "runRipgrepStream").mockImplementation(async (_args, _target, _signal, _cwd, onLines) => {
      onLines([
        JSON.stringify({
          type: "match",
          data: {
            path: { text: path.relative(root, filePath) },
            lines: { text: "foo one\n" },
            line_number: 2,
          },
        }),
      ])
      throw new Error("partial ripgrep failure")
    })

    const result = await callTool<string>(grepFilesTool, { pattern: "foo", path: root })

    expect(result).toContain(filePath)
    expect(result).toContain("2: foo one")
    expect(result).toContain("More results omitted")
  })

  // --- new cases -----------------------------------------------------------

  it("treats a pattern starting with '-' as a literal pattern, not a flag", async () => {
    const root = await mkTemp()
    await writeFile(path.join(root, "dash.txt"), "value -foo bar\nother line\n")

    const result = await callTool<string>(grepFilesTool, { pattern: "-foo", path: root })

    expect(result).toContain(path.join(root, "dash.txt"))
    expect(result).toContain("1: value -foo bar")
  })

  it("searches a single file when the path points at a file (no directory guard)", async () => {
    const root = await makeFixture()
    const file = path.join(root, "src", "a.ts")

    const result = await callTool<string>(grepFilesTool, { pattern: "foo", path: file })

    expect(result).toContain(file)
    expect(result).toContain("2: foo one")
    expect(result).toContain("4: foo two")
    // Only that one file's matches — sibling b.ts must not appear.
    expect(result).not.toContain(path.join(root, "src", "b.ts"))
  })

  it("resolves a relative file path against ctx.cwd", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(
      grepFilesTool,
      { pattern: "foo", path: path.join("src", "b.ts") },
      { cwd: root },
    )

    expect(result).toBe(`${path.join(root, "src", "b.ts")}\n1: foo three`)
  })

  it("uses ctx.cwd when the directory path is omitted", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(grepFilesTool, { pattern: "foo", glob: "**/*.ts" }, { cwd: root })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).not.toContain("README.md")
  })

  it("respects .gitignore inside a real git repo, while glob deliberately does not", async () => {
    const root = await mkTemp()
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" })
    await writeFile(path.join(root, ".gitignore"), "secret.txt\nnode_modules/\n")
    await writeFile(path.join(root, "visible.txt"), "needle here\n")
    await writeFile(path.join(root, "secret.txt"), "needle here\n")
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "needle here\n")

    const grepResult = await callTool<string>(grepFilesTool, { pattern: "needle", path: root })

    expect(grepResult).toContain(path.join(root, "visible.txt"))
    expect(grepResult).not.toContain("secret.txt")
    expect(grepResult).not.toContain("node_modules")

    // Same repo, but glob passes --no-ignore, so it reaches node_modules.
    const globResult = await callTool<string>(globFilesTool, { pattern: "**/index.js", path: root })

    expect(globResult).toContain(path.join(root, "node_modules", "pkg", "index.js"))
  })

  it("searches dotfiles because ripgrep runs with --hidden", async () => {
    const root = await mkTemp()
    await writeFile(path.join(root, ".env"), "TOKEN=envneedle\n")

    const result = await callTool<string>(grepFilesTool, { pattern: "envneedle", path: root })

    expect(result).toContain(path.join(root, ".env"))
    expect(result).toContain("1: TOKEN=envneedle")
  })

  it("does not add a truncation note when exactly 'limit' files match", async () => {
    const root = await makeFixture()

    // "foo" matches exactly three files; limit 3 fits them all.
    const result = await callTool<string>(grepFilesTool, { pattern: "foo", path: root, limit: 3 })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).toContain(path.join(root, "README.md"))
    expect(result).not.toContain("More results omitted")
  })

  it("returns no matches when offset skips past every matching file", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(grepFilesTool, { pattern: "foo", path: root, offset: 10 })

    expect(result).toBe("No matches found.")
  })

  it("merges matches for the same file arriving across separate stream chunks", async () => {
    const root = await makeFixture()
    const file = path.join(root, "src", "a.ts")
    const rel = path.relative(root, file)
    vi.spyOn(ripgrep, "runRipgrepStream").mockImplementation(async (_args, _target, _signal, _cwd, onLines) => {
      onLines([
        JSON.stringify({
          type: "match",
          data: { path: { text: rel }, lines: { text: "foo one\n" }, line_number: 2 },
        }),
      ])
      onLines([
        JSON.stringify({
          type: "match",
          data: { path: { text: rel }, lines: { text: "foo two\n" }, line_number: 4 },
        }),
      ])
    })

    const result = await callTool<string>(grepFilesTool, { pattern: "foo", path: root })

    expect(result).toContain("2: foo one")
    expect(result).toContain("4: foo two")
    // Single group: the file header appears exactly once.
    expect(result.split(file).length - 1).toBe(1)
    // Not double-counted vs offset/limit, so no truncation note.
    expect(result).not.toContain("More results omitted")
  })

  it("trims a trailing CR from a matched CRLF line", async () => {
    const root = await mkTemp()
    await writeFile(path.join(root, "crlf.txt"), "needlecrlf line\r\nsecond\r\n")

    const result = await callTool<string>(grepFilesTool, { pattern: "needlecrlf", path: root })

    expect(result).toContain("1: needlecrlf line")
    expect(result).not.toContain("\r")
  })

  it("says the search was cut short rather than claiming no matches when aborted", async () => {
    const root = await makeFixture()

    const result = await callTool<string>(
      grepFilesTool,
      { pattern: "foo", path: root },
      { signal: AbortSignal.abort() },
    )

    expect(result).not.toBe("No matches found.")
    expect(result).toContain("Search stopped")
  })

  it("returns the ENOENT error when the path does not exist", async () => {
    const root = await makeFixture()
    const missing = path.join(root, "does-not-exist")

    const result = await callTool<string>(grepFilesTool, { pattern: "foo", path: missing })

    expect(result).toMatch(/ENOENT/)
  })

  it("has no toModelOutput transform (returns a plain string)", () => {
    expect(grepFilesTool.toModelOutput).toBeUndefined()
  })
})
