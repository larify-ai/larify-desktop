import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { globFilesTool } from "../../../../src/extensions/file/main/glob"

const tempDirs: string[] = []

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-glob-"))
  tempDirs.push(root)
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
  it("finds files by glob pattern under an explicit path", async () => {
    const root = await makeFixture()

    const result = await globFilesTool.execute({ pattern: "**/*.ts", path: root }, { sessionId: "test" })

    expect(result).toContain(path.join(root, "src", "a.ts"))
    expect(result).toContain(path.join(root, "src", "b.ts"))
    expect(result).not.toContain("README.md")
  })

  it("uses the session cwd when path is omitted", async () => {
    const root = await makeFixture()

    const result = await globFilesTool.execute({ pattern: "README.md" }, { sessionId: "test", cwd: root })

    expect(result).toBe(path.join(root, "README.md"))
  })

  it("shows omitted file ranges when paginated", async () => {
    const root = await makeFixture()

    const result = await globFilesTool.execute(
      { pattern: "**/*", path: root, limit: 1, offset: 1 },
      { sessionId: "test" },
    )

    expect(result).toMatch(/^\(Matching files 1-1 omitted\.\)\n/)
    expect(result).toMatch(/\n\(Matching files 3-\d+ omitted\.\)$/)
  })

  it("throws when path is not a directory", async () => {
    const root = await makeFixture()
    const filePath = path.join(root, "README.md")

    await expect(
      globFilesTool.execute({ pattern: "**/*", path: filePath }, { sessionId: "test" }),
    ).rejects.toThrow("Path is not a directory")
  })
})
