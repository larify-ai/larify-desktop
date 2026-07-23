import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTwoFilesPatch } from "diff"
import iconv from "iconv-lite"
import { editFileTool } from "../../../../src/extensions/file/main/edit"
import { CHUNK_BYTES } from "../../../../src/extensions/file/main/stream"
import { markRead } from "../../../../src/extensions/file/main/state"
import { normalizeLineBreaks } from "../../../../src/main/utils/text"
import { callTool, freshSession } from "./harness"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "larify-edit-diff-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function groundTruth(abs: string, rawOld: string, needle: string, replacement: string): string {
  const old = normalizeLineBreaks(rawOld)
  const updated = old.split(needle).join(replacement)
  return createTwoFilesPatch(abs, abs, old, updated, "", "", { context: 3 })
}

async function edit(
  rawOld: string,
  needle: string,
  replacement: string,
  replaceAll = false,
): Promise<{ abs: string; patch: string; disk: string }> {
  const session = freshSession()
  const abs = join(dir, `${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(abs, rawOld)
  markRead(session, abs, statSync(abs).mtimeMs)

  const result = await callTool<{ patch: string }>(
    editFileTool,
    { file_path: abs, old_string: needle, new_string: replacement, replace_all: replaceAll },
    { sessionId: session },
  )
  return { abs, patch: result.patch, disk: readFileSync(abs, "utf8") }
}

const numberedLines = (count: number, mark?: { at: number; text: string }): string =>
  Array.from({ length: count }, (_, i) =>
    mark && i + 1 === mark.at ? mark.text : `line ${i + 1}`,
  ).join("\n")

describe("edit — patch equals whole-file ground truth", () => {
  it("localized change deep inside a large file", async () => {
    const old = numberedLines(5000, { at: 2500, text: "line 2500 UNIQUE_TARGET" })
    const { abs, patch, disk } = await edit(old, "UNIQUE_TARGET", "REPLACED")

    expect(patch).toBe(groundTruth(abs, old, "UNIQUE_TARGET", "REPLACED"))
    expect(disk).toContain("line 2500 REPLACED")
    expect(patch.split("\n").length).toBeLessThan(20)
  })

  it("change on the very first line", async () => {
    const old = numberedLines(500, { at: 1, text: "FIRST here" })
    const { abs, patch } = await edit(old, "FIRST", "HEAD")
    expect(patch).toBe(groundTruth(abs, old, "FIRST", "HEAD"))
  })

  it("change on the last line of a file with no trailing newline", async () => {
    const old = numberedLines(500, { at: 500, text: "LAST here" })
    const { abs, patch } = await edit(old, "LAST", "TAIL")
    expect(patch).toBe(groundTruth(abs, old, "LAST", "TAIL"))
    expect(patch).toContain("No newline at end of file")
  })

  it("deletion (empty replacement) inside a large file", async () => {
    const old = numberedLines(1000, { at: 400, text: "line 400 DROP_ME kept" })
    const { abs, patch, disk } = await edit(old, "DROP_ME ", "")
    expect(patch).toBe(groundTruth(abs, old, "DROP_ME ", ""))
    expect(disk).toContain("line 400 kept")
  })

  it("multi-line old_string spanning two lines in a large file", async () => {
    const old = numberedLines(2000, { at: 900, text: "ninehundred" })
    const needle = "ninehundred\nline 901"
    const { abs, patch, disk } = await edit(old, needle, "MERGED")
    expect(patch).toBe(groundTruth(abs, old, needle, "MERGED"))
    expect(disk).toContain("line 899\nMERGED\nline 902")
  })

  it("multi-line replacement text inside a large file", async () => {
    const old = numberedLines(3000, { at: 1500, text: "line 1500 SWAP" })
    const { abs, patch, disk } = await edit(old, "SWAP", "ONE\ntwo\nthree")
    expect(patch).toBe(groundTruth(abs, old, "SWAP", "ONE\ntwo\nthree"))
    expect(disk).toContain("line 1500 ONE\ntwo\nthree\nline 1501")
  })
})

describe("edit — replace_all across a large file", () => {
  it("merges nearby hits into one hunk and keeps distant hits separate, matching ground truth", async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `row ${i + 1}`)
    lines[9] = "row 10 TOK"
    lines[11] = "row 12 TOK"
    lines[299] = "row 300 TOK"
    const old = lines.join("\n")

    const { abs, patch, disk } = await edit(old, "TOK", "TAK", true)

    expect(patch).toBe(groundTruth(abs, old, "TOK", "TAK"))
    expect(disk).toContain("row 10 TAK")
    expect(disk).toContain("row 12 TAK")
    expect(disk).toContain("row 300 TAK")
    const hunks = (patch.match(/^@@ /gm) ?? []).length
    expect(hunks).toBe(2)
  })
})

describe("edit — matches spanning a 1MB chunk boundary", () => {
  it("finds, replaces and diffs a needle straddling the chunk boundary", async () => {
    const unit = "abcdefgh\n"
    const before = Math.floor((CHUNK_BYTES - 4) / unit.length)
    let head = unit.repeat(before)
    head += "p".repeat(CHUNK_BYTES - 4 - head.length)
    const needle = "STRADDLE"
    const old = `${head}${needle}\nZ line\nY line\n`

    expect(head.length).toBe(CHUNK_BYTES - 4)

    const { abs, patch, disk } = await edit(old, needle, "REPLACED")

    expect(disk).toContain("REPLACED\nZ line\nY line")
    expect(disk).not.toContain("STRADDLE")
    expect(patch).toBe(groundTruth(abs, old, needle, "REPLACED"))
  })

  it("replaces hits spread across several chunks and matches ground truth", async () => {
    const block = "lorem ipsum dolor sit amet consectetur\n".repeat(40000)
    const old = `head GAP one\n${block}middle GAP two\n${block}tail GAP end\n`

    const { abs, patch, disk } = await edit(old, "GAP", "X", true)

    expect(disk).not.toContain("GAP")
    expect((disk.match(/X/g) ?? []).length).toBe(3)
    expect(patch).toBe(groundTruth(abs, old, "GAP", "X"))
  })
})

describe("edit — CRLF is preserved on disk while the patch stays LF", () => {
  it("keeps CRLF line endings after an edit", async () => {
    const old = "a\r\nb\r\nc\r\n"
    const { abs, patch } = await edit(old, "b", "B")

    const raw = readFileSync(abs)
    expect(raw.toString("utf8")).toBe("a\r\nB\r\nc\r\n")
    expect(patch).toBe(groundTruth(abs, old, "b", "B"))
    expect(patch).not.toContain("\r")
  })

  it("keeps CRLF when editing a line in the middle of a larger file", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => (i + 1 === 100 ? "row 100 MARK" : `row ${i + 1}`))
    const raw = `${rows.join("\r\n")}\r\n`
    const { abs, patch, disk } = await edit(raw, "MARK", "DONE")

    const expected = `${rows.map((r) => (r === "row 100 MARK" ? "row 100 DONE" : r)).join("\r\n")}\r\n`
    expect(disk).toBe(expected)
    expect(patch).toBe(groundTruth(abs, raw, "MARK", "DONE"))
    expect(patch).not.toContain("\r")
  })
})

describe("edit — more streaming boundary cases", () => {
  it("a UTF-8 multibyte char split across the 1MB chunk boundary is not corrupted", async () => {
    const unit = "line\n"
    let head = unit.repeat(Math.floor((CHUNK_BYTES - 1) / unit.length))
    head += "x".repeat(CHUNK_BYTES - 1 - head.length)
    const old = `${head}°MARKER\nZ line\n`

    const { abs, patch, disk } = await edit(old, "MARKER", "DONE")

    expect(disk).toContain("°DONE")
    expect(readFileSync(abs).includes(Buffer.from([0xc2, 0xb0]))).toBe(true)
    expect(patch).toBe(groundTruth(abs, old, "MARKER", "DONE"))
  })

  it("replacement much larger than the needle grows the file correctly", async () => {
    const old = numberedLines(3000, { at: 1500, text: "line 1500 SEED" })
    const big = "X".repeat(5000)
    const { abs, patch, disk } = await edit(old, "SEED", big)

    expect(disk).toContain(`line 1500 ${big}`)
    expect(patch).toBe(groundTruth(abs, old, "SEED", big))
  })

  it("replaces overlapping-candidate hits left to right (replace_all)", async () => {
    const { abs, patch, disk } = await edit("aaaa", "aa", "b", true)
    expect(disk).toBe("bb")
    expect(patch).toBe(groundTruth(abs, "aaaa", "aa", "b"))
  })

  it("matches a needle longer than one 1MB chunk (window growth)", async () => {
    const needle = `START ${"z".repeat(CHUNK_BYTES + 100)} END`
    const old = `head line\n${needle}\ntail line\n`
    const { disk } = await edit(old, needle, "SHORT")
    expect(disk).toBe("head line\nSHORT\ntail line\n")
  })

  it("edits a single-line file with no newlines (neighborhood is the whole line)", async () => {
    const old = `prefix ${"m".repeat(100000)} TARGET ${"n".repeat(100000)} suffix`
    const { abs, patch, disk } = await edit(old, "TARGET", "HIT")
    expect(disk).toContain(" HIT ")
    expect(patch).toBe(groundTruth(abs, old, "TARGET", "HIT"))
  })

  it("handles hundreds of spread-out replace_all hits and matches ground truth", async () => {
    const old = Array.from({ length: 5000 }, (_, i) => (i % 10 === 0 ? `row ${i + 1} TAG` : `row ${i + 1}`)).join("\n")
    const { abs, patch, disk } = await edit(old, "TAG", "X", true)
    expect((disk.match(/ X$/gm) ?? []).length).toBe(500)
    expect(patch).toBe(groundTruth(abs, old, "TAG", "X"))
  })

  it("merges two hits at the exact threshold and splits one past it (vs ground truth)", async () => {
    const withHits = (secondAt: number): string => {
      const rows = Array.from({ length: 60 }, (_, i) => `r${i + 1}`)
      rows[9] = "r10 K"
      rows[secondAt] = `r${secondAt + 1} K`
      return rows.join("\n")
    }
    const mergedOld = withHits(9 + 6 + 1)
    const m = await edit(mergedOld, "K", "Q", true)
    expect(m.patch).toBe(groundTruth(m.abs, mergedOld, "K", "Q"))
    expect((m.patch.match(/^@@ /gm) ?? []).length).toBe(1)

    const splitOld = withHits(9 + 7 + 1)
    const s = await edit(splitOld, "K", "Q", true)
    expect(s.patch).toBe(groundTruth(s.abs, splitOld, "K", "Q"))
    expect((s.patch.match(/^@@ /gm) ?? []).length).toBe(2)
  })

  it("replaces a needle at the very start of the file (offset 0)", async () => {
    const old = numberedLines(500, { at: 1, text: "HEAD marker" })
    const { abs, patch, disk } = await edit(old, "HEAD", "TOP")
    expect(disk.startsWith("TOP marker")).toBe(true)
    expect(patch).toBe(groundTruth(abs, old, "HEAD", "TOP"))
  })

  it("replaces a needle spanning the entire file", async () => {
    const old = "the whole file is the needle"
    const { abs, patch, disk } = await edit(old, old, "replaced entirely")
    expect(disk).toBe("replaced entirely")
    expect(patch).toBe(groundTruth(abs, old, old, "replaced entirely"))
  })

  it("captures a >1MB single line (no newlines) as the neighborhood", async () => {
    const old = `${"a".repeat(CHUNK_BYTES + 50000)}TARGET${"b".repeat(50000)}`
    const { abs, patch, disk } = await edit(old, "TARGET", "HIT")
    expect(disk).toContain("aHITb")
    expect(patch).toBe(groundTruth(abs, old, "TARGET", "HIT"))
  })

  it("a mid-file change in a file with no trailing newline carries no EOF marker", async () => {
    const old = numberedLines(500, { at: 250, text: "line 250 MIDDLE" })
    const { abs, patch } = await edit(old, "MIDDLE", "CENTER")
    expect(patch).toBe(groundTruth(abs, old, "MIDDLE", "CENTER"))
    expect(patch).not.toContain("No newline")
  })
})

describe("edit — encoding & line-ending edges", () => {
  it("replaces a multi-line needle in a CRLF file, keeping CRLF on disk", async () => {
    const old = "a\r\nOLD1\r\nOLD2\r\nb\r\n"
    const { abs, patch, disk } = await edit(old, "OLD1\nOLD2", "NEW")
    expect(disk).toBe("a\r\nNEW\r\nb\r\n")
    expect(patch).toBe(groundTruth(abs, old, "OLD1\nOLD2", "NEW"))
    expect(patch).not.toContain("\r")
  })

  it("preserves a leading UTF-8 BOM when editing", async () => {
    const old = "\uFEFFconst a = 1\n"
    const { abs, patch } = await edit(old, "a = 1", "a = 2")
    expect(readFileSync(abs)).toEqual(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("const a = 2\n", "utf8")]),
    )
    expect(patch).toBe(groundTruth(abs, old, "a = 1", "a = 2"))
  })
})

describe("edit — large non-UTF-8 file streamed", () => {
  it("edits a >1MB GBK file across chunk boundaries, writing UTF-8 back", async () => {
    const filler = "这是用于填充文件的中文行内容。\n"
    const reps = Math.ceil(700000 / iconv.encode(filler, "gbk").length)
    const chinese = `${filler.repeat(reps)}标记点\n${filler.repeat(reps)}`
    const abs = join(dir, "big-gbk.txt")
    writeFileSync(abs, iconv.encode(chinese, "gbk"))
    expect(readFileSync(abs).length).toBeGreaterThan(CHUNK_BYTES)

    const session = freshSession()
    markRead(session, abs, statSync(abs).mtimeMs)
    const result = await callTool<{ patch: string }>(
      editFileTool,
      { file_path: abs, old_string: "标记点", new_string: "已替换" },
      { sessionId: session },
    )

    const updated = chinese.split("标记点").join("已替换")
    expect(readFileSync(abs).equals(Buffer.from(updated, "utf8"))).toBe(true)
    expect(result.patch).toBe(createTwoFilesPatch(abs, abs, chinese, updated, "", "", { context: 3 }))
  })
})

describe("edit — performance guard", () => {
  it("edits a 40MB file correctly within a generous time budget", async () => {
    const line = "const value = 1234; // ordinary line of source code here"
    const n = Math.floor((40 * 1048576) / (line.length + 1))
    const rows = Array.from({ length: n }, (_, i) => (i === (n >> 1) ? "const PERF_TARGET = 0;" : line))
    const old = rows.join("\n")

    const started = performance.now()
    const { disk, patch } = await edit(old, "PERF_TARGET", "RENAMED")
    const elapsed = performance.now() - started

    expect(disk).toContain("const RENAMED = 0;")
    expect(patch.split("\n").length).toBeLessThan(20)
    expect(elapsed).toBeLessThan(8000)
  }, 30000)
})
