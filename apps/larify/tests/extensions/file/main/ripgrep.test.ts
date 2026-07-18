import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runRipgrep, runRipgrepLimited } from "../../../../src/extensions/file/main/ripgrep"

const tempDirs: string[] = []

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-ripgrep-"))
  tempDirs.push(root)
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
})
