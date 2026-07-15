import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { lsTool } from "../../../../src/extensions/file/main/ls"

const tempDirs: string[] = []

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "larify-ls-"))
  tempDirs.push(root)
  await mkdir(path.join(root, "components"))
  await mkdir(path.join(root, "extensions"))
  await writeFile(path.join(root, "main.ts"), "main")
  await writeFile(path.join(root, "preload.ts"), "preload")
  return root
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("ls", () => {
  it("lists directory items", async () => {
    const root = await makeFixture()

    const result = await lsTool.execute({ path: root }, { sessionId: "test" })

    expect(result.split("\n")).toEqual(expect.arrayContaining(["components/", "extensions/", "main.ts", "preload.ts"]))
  })

  it("uses the session cwd when path is omitted", async () => {
    const root = await makeFixture()

    const result = await lsTool.execute({}, { sessionId: "test", cwd: root })

    expect(result).toContain("components/")
    expect(result).toContain("main.ts")
  })

  it("shows omitted item ranges when paginated", async () => {
    const root = await makeFixture()

    const result = await lsTool.execute({ path: root, limit: 2, offset: 1 }, { sessionId: "test" })

    expect(result).toMatch(/^\(Items 1-1 omitted\.\)\n/)
    expect(result).toMatch(/\n\(Items 4-4 omitted\.\)$/)
  })

  it("returns a clear message for an empty directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "larify-ls-empty-"))
    tempDirs.push(root)

    const result = await lsTool.execute({ path: root }, { sessionId: "test" })

    expect(result).toBe("No items found.")
  })

  it("throws when path is not a directory", async () => {
    const root = await makeFixture()
    const filePath = path.join(root, "main.ts")

    await expect(lsTool.execute({ path: filePath }, { sessionId: "test" })).rejects.toThrow("Path is not a directory")
  })
})
