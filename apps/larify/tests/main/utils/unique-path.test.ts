import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createUniqueDir,
  createUniqueFile,
  shortToken,
} from "../../../src/main/utils/unique-path"

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "larify-unique-path-"))
  roots.push(root)
  return root
}

afterEach(() => {
  roots.length = 0
})

const ID_PATTERN = /^[0-9a-z]{8}$/

describe("shortToken", () => {
  it("is 8 lowercase base36 characters", () => {
    for (let i = 0; i < 200; i++) expect(shortToken()).toMatch(ID_PATTERN)
  })

  it("does not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => shortToken()))
    expect(seen.size).toBe(2000)
  })
})

describe("createUniqueFile", () => {
  it("creates the file on disk and returns a short base36 name", () => {
    const root = makeRoot()

    const path = createUniqueFile(root, "log")

    expect(existsSync(path)).toBe(true)
    expect(statSync(path).isFile()).toBe(true)
    expect(dirname(path)).toBe(root)
    expect(basename(path, ".log")).toMatch(ID_PATTERN)
  })

  it("omits the extension when none is given", () => {
    const root = makeRoot()

    const path = createUniqueFile(root)

    expect(basename(path)).toMatch(ID_PATTERN)
    expect(existsSync(path)).toBe(true)
  })

  it("creates the directory when it does not exist yet", () => {
    const root = makeRoot()
    const nested = join(root, "a", "b", "c")

    const path = createUniqueFile(nested, "log")

    expect(existsSync(path)).toBe(true)
    expect(dirname(path)).toBe(nested)
  })

  it("never hands out the same path twice", () => {
    const root = makeRoot()
    const paths = new Set<string>()

    for (let i = 0; i < 500; i++) paths.add(createUniqueFile(root, "log"))

    expect(paths.size).toBe(500)
    expect(readdirSync(root)).toHaveLength(500)
  })

  it("uses a preferred id when it is free", () => {
    const root = makeRoot()

    const path = createUniqueFile(root, "log", "abcd1234")

    expect(basename(path)).toBe("abcd1234.log")
  })

  it("falls back to a fresh id when the preferred one is taken", () => {
    const root = makeRoot()
    writeFileSync(join(root, "abcd1234.log"), "taken")

    const path = createUniqueFile(root, "log", "abcd1234")

    expect(basename(path)).not.toBe("abcd1234.log")
    expect(basename(path, ".log")).toMatch(ID_PATTERN)
    expect(existsSync(path)).toBe(true)
  })

  it("ignores a preferred id that could escape the directory", () => {
    const root = makeRoot()
    const outside = makeRoot()

    const path = createUniqueFile(root, "log", `../${basename(outside)}/escaped`)

    expect(dirname(path)).toBe(root)
    expect(basename(path, ".log")).toMatch(ID_PATTERN)
    expect(readdirSync(outside)).toEqual([])
  })

  it("ignores a preferred id that is not a plain short token", () => {
    const root = makeRoot()

    for (const bad of ["UPPERCASE", "has space", "toolongtoolong", "sh0rt", "dot.dot"]) {
      const path = createUniqueFile(root, "log", bad)
      expect(basename(path, ".log")).toMatch(ID_PATTERN)
    }
  })

  it("does not clobber an existing file", () => {
    const root = makeRoot()
    const taken = join(root, "abcd1234.log")
    writeFileSync(taken, "original")

    createUniqueFile(root, "log", "abcd1234")

    expect(readdirSync(root)).toHaveLength(2)
  })

  it("propagates errors that are not name collisions", () => {
    const root = makeRoot()
    const blocked = join(root, "blocked")
    writeFileSync(blocked, "i am a file, not a directory")

    expect(() => createUniqueFile(join(blocked, "inside"), "log")).toThrow()
  })
})

describe("createUniqueDir", () => {
  it("creates a real directory with a short base36 name", () => {
    const root = makeRoot()

    const path = createUniqueDir(root)

    expect(statSync(path).isDirectory()).toBe(true)
    expect(basename(path)).toMatch(ID_PATTERN)
  })

  it("never hands out the same directory twice", () => {
    const root = makeRoot()
    const paths = new Set<string>()

    for (let i = 0; i < 200; i++) paths.add(createUniqueDir(root))

    expect(paths.size).toBe(200)
    expect(readdirSync(root)).toHaveLength(200)
  })

  it("does not adopt a directory that already exists", () => {
    const root = makeRoot()
    const existing = join(root, "zzzzzzzz")
    mkdirSync(existing)
    writeFileSync(join(existing, "planted.txt"), "planted")

    const path = createUniqueDir(root)

    expect(path).not.toBe(existing)
    expect(readdirSync(path)).toEqual([])
  })
})
