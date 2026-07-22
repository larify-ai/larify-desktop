import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { grepFilesTool } from "../../../../src/extensions/file/main/grep"
import { callTool } from "./harness"

let root: string

const grep = (input: Record<string, unknown>, signal?: AbortSignal) =>
  callTool<string>(grepFilesTool, input, { signal })

const quotedLines = (output: string): string[] =>
  output.split("\n").filter((row) => /^\d+: /.test(row))

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "larify-bounds-"))
})

afterAll(() => {
  rmSync(root, { force: true, recursive: true })
})

describe("one noisy file cannot crowd out the others", () => {
  it("caps each file and still reports every matching file", async () => {
    const dir = path.join(root, "noisy")
    mkdirSync(dir)
    writeFileSync(
      path.join(dir, "a-huge.log"),
      Array.from({ length: 40_000 }, (_, i) => `line ${i} needle`).join("\n"),
    )
    writeFileSync(path.join(dir, "b-small.ts"), "const needle = 1\n")
    writeFileSync(path.join(dir, "c-small.ts"), "const needle = 2\n")

    const output = await grep({ pattern: "needle", path: dir })

    expect(output).toContain("a-huge.log")
    expect(output).toContain("b-small.ts")
    expect(output).toContain("c-small.ts")
    expect(output).toContain("…")
    expect(quotedLines(output).length).toBeLessThan(40)
  }, 120_000)
})

describe("a single enormous line cannot flood the answer", () => {
  it("truncates the quoted line and says so", async () => {
    const dir = path.join(root, "long")
    mkdirSync(dir)
    writeFileSync(path.join(dir, "bundle.js"), `${"x".repeat(200_000)}needle${"y".repeat(200_000)}\n`)

    const output = await grep({ pattern: "needle", path: dir })

    expect(output).toContain("…")
    expect(output.length).toBeLessThan(2_000)
  }, 120_000)
})

describe("an interrupted search is not reported as a ripgrep failure", () => {
  it("never surfaces a raw exit code to the caller", async () => {
    const dir = path.join(root, "abort")
    mkdirSync(dir)
    for (let i = 0; i < 300; i++) {
      writeFileSync(path.join(dir, `f${i}.txt`), "needle\n".repeat(80))
    }

    const controller = new AbortController()
    const running = grep({ pattern: "needle", path: dir, limit: 300 }, controller.signal)
    setTimeout(() => controller.abort(), 15)

    const output = await running
    expect(output).not.toContain("exited with code")
  }, 120_000)
})

describe("quoted lines really contain the pattern", () => {
  it("indexes a non-UTF-8 file the way ripgrep numbers it, even with a bare CR", async () => {
    const dir = path.join(root, "cr")
    mkdirSync(dir)
    const file = path.join(dir, "mixed.txt")
    const body = ["start\rmiddle", "plain filler line", "配置项 needle here"].join("\n") + "\n"
    writeFileSync(file, iconv.encode(body, "gbk"))

    const output = await grep({ pattern: "needle", path: dir })

    const quoted = quotedLines(output)
    expect(quoted.length).toBeGreaterThan(0)
    for (const row of quoted) expect(row).toContain("needle")
  }, 120_000)
})
