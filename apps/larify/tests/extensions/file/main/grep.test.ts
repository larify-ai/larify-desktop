import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { grepFilesTool } from "../../../../src/extensions/file/main/grep"

const tempDirs: string[] = []

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-grep-"))
  tempDirs.push(root)
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "a.ts"), "alpha\nfoo one\nbeta\nfoo two\n")
  await writeFile(path.join(root, "src", "b.ts"), "foo three\nplain\n")
  await writeFile(path.join(root, "README.md"), "foo docs\n")
  await writeFile(path.join(root, "notes.txt"), "nothing\n")

  return root
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("grep", () => {
  it("groups matching lines by file", async () => {
    const root = await makeFixture()

    const result = await grepFilesTool.execute({ pattern: "foo", path: root }, { sessionId: "test" })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain("2: foo one")
    expect(result).toContain("4: foo two")
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).toContain("1: foo three")
  })

  it("filters files with a glob", async () => {
    const root = await makeFixture()

    const result = await grepFilesTool.execute(
      { pattern: "foo", path: root, glob: "**/*.ts" },
      { sessionId: "test" },
    )

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).not.toContain("README.md")
  })

  it("uses the session cwd when path is omitted", async () => {
    const root = await makeFixture()

    const result = await grepFilesTool.execute({ pattern: "foo docs" }, { sessionId: "test", cwd: root })

    expect(result).toBe(`${path.join(root, "README.md")}\n1: foo docs`)
  })

  it("shows omitted file ranges when paginated by file", async () => {
    const root = await makeFixture()

    const result = await grepFilesTool.execute(
      { pattern: "foo", path: root, limit: 1, offset: 1 },
      { sessionId: "test" },
    )

    expect(result).toMatch(/^\(Matching files 1-1 omitted\.\)\n\n/)
    expect(result).toMatch(new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\n\\d+: foo`))
    expect(result).toMatch(/\n\n\(Matching files 3-3 omitted\.\)$/)
  })

  it("returns a clear message when no files match", async () => {
    const root = await makeFixture()

    const result = await grepFilesTool.execute({ pattern: "missing", path: root }, { sessionId: "test" })

    expect(result).toBe("No matches found.")
  })
})
