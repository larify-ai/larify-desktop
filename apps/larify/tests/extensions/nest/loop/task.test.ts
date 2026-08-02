import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { childTaskFiles, parentTaskFile } from "../../../../src/extensions/nest/utils/task"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("task hierarchy", () => {
  it("finds child and parent task files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "larify-nest-loop-"))
    roots.push(root)
    const rootTask = path.join(root, "task.md")
    const childDirectory = path.join(root, "1_child")
    const childTask = path.join(childDirectory, "task.md")
    await mkdir(childDirectory)
    await writeFile(rootTask, "# Events\n")
    await writeFile(childTask, "# Events\n")

    expect(childTaskFiles(rootTask)).toEqual([childTask])
    expect(parentTaskFile(childTask, rootTask)).toBe(rootTask)
    expect(parentTaskFile(rootTask, rootTask)).toBeUndefined()
  })
})
