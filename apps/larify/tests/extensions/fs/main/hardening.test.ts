import { execFileSync } from "node:child_process"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { globFilesTool } from "../../../../src/extensions/fs/main/glob"
import { grepFilesTool } from "../../../../src/extensions/fs/main/grep"
import { readFileTool } from "../../../../src/extensions/fs/main/read"
import { editFileTool } from "../../../../src/extensions/fs/main/edit"
import { writeFileTool } from "../../../../src/extensions/fs/main/write"
import { readAtFor } from "../../../../src/extensions/fs/main/state"
import { callTool, freshSession } from "./harness"

let root: string
let session: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-hardening-"))
  session = freshSession()
  mkdirSync(path.join(root, "main"))
  mkdirSync(path.join(root, "other"))
  writeFileSync(path.join(root, "main", "a.ts"), "const needle = 1\n")
  writeFileSync(path.join(root, "other", "b.ts"), "const needle = 2\n")
})

afterAll(() => {
  rmSync(root, { force: true, recursive: true })
})

const glob = (input: Record<string, unknown>) => callTool<string>(globFilesTool, input)
const grep = (input: Record<string, unknown>) => callTool<string>(grepFilesTool, input)

describe("globs are anchored at the search directory, not the process cwd", () => {
  it("selects one subdirectory with a rooted pattern", async () => {
    const output = await glob({ pattern: "main/*.ts", path: root })

    expect(output).not.toBe("No files found.")
    expect(output).toContain(path.join("main", "a.ts"))
    expect(output).not.toContain(path.join("other", "b.ts"))
  })

  it("matches a bare basename pattern at any depth", async () => {
    const output = await glob({ pattern: "*.ts", path: root })

    expect(output).toContain(path.join("main", "a.ts"))
    expect(output).toContain(path.join("other", "b.ts"))
  })

  it("honours a rooted negated pattern", async () => {
    const output = await glob({ pattern: "!main/*.ts", path: root })

    expect(output).not.toContain(path.join("main", "a.ts"))
    expect(output).toContain(path.join("other", "b.ts"))
  })

  it("resolves a rooted pattern against path, not against the process cwd", async () => {
    const fromNestedCwd = await callTool<string>(
      globFilesTool,
      { pattern: "main/*.ts", path: root },
      { cwd: path.join(root, "other") },
    )

    expect(fromNestedCwd).toContain(path.join("main", "a.ts"))
  })
})

describe("grep glob filter", () => {
  it("restricts the search with a rooted pattern", async () => {
    const output = await grep({ pattern: "needle", path: root, glob: "main/*.ts" })

    expect(output).not.toBe("No matches found.")
    expect(output).toContain(path.join("main", "a.ts"))
    expect(output).not.toContain(path.join("other", "b.ts"))
  })

  it("still rejects a pattern ripgrep cannot compile", async () => {
    await expect(grep({ pattern: "(unclosed", path: root })).rejects.toThrow()
  })
})

describe("aborted searches do not outlive the call", () => {
  it("leaves the searched directory deletable immediately after returning", async () => {
    const doomed = mkdtempSync(path.join(tmpdir(), "larify-abort-"))
    for (let i = 0; i < 200; i++) writeFileSync(path.join(doomed, `f${i}.ts`), "needle\n")

    const controller = new AbortController()
    const running = callTool<string>(grepFilesTool, { pattern: "needle", path: doomed, limit: 1 }, { signal: controller.signal })
    controller.abort()
    await running

    expect(() => rmSync(doomed, { recursive: true })).not.toThrow()
  })
})

describe("edit rejects an empty old_string", () => {
  it("refuses the call instead of splicing new_string between every character", async () => {
    const file = path.join(root, "main", "a.ts")
    await callTool<string>(readFileTool, { file_path: file }, { sessionId: session })

    expect(() =>
      callTool(editFileTool, { file_path: file, old_string: "", new_string: "X", replace_all: true }, { sessionId: session }),
    ).toThrow()

    expect(readFileSync(file, "utf8")).toBe("const needle = 1\n")
  })
})

describe("write to a path that is a directory", () => {
  it("names the real problem instead of asking for a read first", async () => {
    await expect(
      callTool(writeFileTool, { file_path: path.join(root, "main"), content: "x" }, { sessionId: session }),
    ).rejects.toThrow("is a directory")
  })
})

describe("read state is keyed by the resolved absolute path", () => {
  it("treats every spelling of the same relative path as one file", async () => {
    const sessionId = freshSession()

    await callTool<string>(
      readFileTool,
      { file_path: "main/./../main/a.ts" },
      { sessionId, cwd: root },
    )

    expect(readAtFor(sessionId, path.join(root, "main", "a.ts"))).toBeTypeOf("number")
  })

  it("edits a file that was read through a differently spelled relative path", async () => {
    await callTool<string>(readFileTool, { file_path: "main/a.ts" }, { sessionId: session, cwd: root })

    await callTool(
      editFileTool,
      { file_path: "./main/../main/a.ts", old_string: "const needle = 1", new_string: "const needle = 9" },
      { sessionId: session, cwd: root },
    )

    expect(readFileSync(path.join(root, "main", "a.ts"), "utf8")).toBe("const needle = 9\n")
  })

  it("serialises concurrent edits to one file so no update is lost", async () => {
    const file = path.join(root, "main", "a.ts")
    writeFileSync(file, "0\n")
    await callTool<string>(readFileTool, { file_path: file }, { sessionId: session })

    const results = await Promise.allSettled([
      callTool(editFileTool, { file_path: file, old_string: "0", new_string: "1" }, { sessionId: session }),
      callTool(editFileTool, { file_path: file, old_string: "0", new_string: "2" }, { sessionId: session }),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(["1\n", "2\n"]).toContain(readFileSync(file, "utf8"))
  })
})

describe("boundaries the tool descriptions promise", () => {
  it("glob returns files but never directories", async () => {
    const output = await glob({ pattern: "*", path: root })

    expect(output).toContain("a.ts")
    expect(output.split("\n")).not.toContain(path.join(root, "main"))
    expect(output).not.toContain(`${path.sep}main\n`)
  })

  it("glob reaches gitignored files while grep skips them", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "larify-ignore-"))
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" })
    writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n")
    mkdirSync(path.join(repo, "node_modules"))
    writeFileSync(path.join(repo, "node_modules", "dep.ts"), "needle\n")
    writeFileSync(path.join(repo, "own.ts"), "needle\n")

    expect(await glob({ pattern: "**/*.ts", path: repo })).toContain("dep.ts")

    const swept = await grep({ pattern: "needle", path: repo })
    expect(swept).toContain("own.ts")
    expect(swept).not.toContain("dep.ts")

    const named = await grep({ pattern: "needle", path: path.join(repo, "node_modules", "dep.ts") })
    expect(named).toContain("dep.ts")
  })

  it("grep skips binary files when sweeping a directory", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "larify-binsweep-"))
    writeFileSync(path.join(dir, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 110, 101, 101, 100, 108, 101, 0]))

    expect(await grep({ pattern: "needle", path: dir })).toBe("No matches found.")
  })
})

describe("UTF-8 BOM round trip", () => {
  it("preserves the leading BOM bytes when the file is written back", async () => {
    const file = path.join(root, "bom.ts")
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    writeFileSync(file, Buffer.concat([bom, Buffer.from("const a = 1\n", "utf8")]))

    const shown = await callTool<string>(readFileTool, { file_path: file }, { sessionId: session })
    await callTool(
      writeFileTool,
      { file_path: file, content: shown.replace("const a = 1", "const a = 2") },
      { sessionId: session },
    )

    expect(readFileSync(file)).toEqual(Buffer.concat([bom, Buffer.from("const a = 2\n", "utf8")]))
  })
})
