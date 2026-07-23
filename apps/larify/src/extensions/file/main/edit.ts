import { open, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { formatPatch, structuredPatch } from "diff"
import { z } from "zod"
import { defineTool } from "../../../shared/tool"
import { applyLineBreaks, dominantLineBreak, normalizeLineBreaks } from "../../../main/utils/text"
import { decodeLossy } from "./encoding"
import { normalizedChunks } from "./stream"
import { markRead, readAtFor, withFileLock } from "./state"

const CONTEXT = 3
const SNIFF_BYTES = 1 << 16

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file"),
  old_string: z.string().min(1).describe("The exact text to replace"),
  new_string: z.string().describe("The text to replace it with"),
  replace_all: z.boolean().default(false).describe("Replace all occurrences (default false)"),
}).strict()

interface Match {
  offset: number
  line: number
}

interface Range {
  startLine: number
  endLine: number
  offsets: number[]
}

interface Region extends Range {
  startOffset: number
  text: string
}

const countNewlines = (text: string, end: number): number => {
  let count = 0
  for (let at = text.indexOf("\n"); at >= 0 && at < end; at = text.indexOf("\n", at + 1)) count += 1
  return count
}

async function sniffLineBreak(target: string): Promise<string> {
  const handle = await open(target, "r")
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return dominantLineBreak(decodeLossy(buffer.subarray(0, bytesRead)))
  } finally {
    await handle.close()
  }
}

async function findMatches(target: string, needle: string): Promise<Match[]> {
  const matches: Match[] = []
  const keep = needle.length - 1
  let index = 0
  let line = 1
  let window = ""
  for await (const chunk of normalizedChunks(target)) {
    window += chunk
    let from = 0
    for (let at = window.indexOf(needle, from); at >= 0; at = window.indexOf(needle, from)) {
      matches.push({ offset: index + at, line: line + countNewlines(window, at) })
      from = at + needle.length
    }
    const retain = Math.max(from, window.length - keep)
    line += countNewlines(window, retain)
    index += retain
    window = window.slice(retain)
  }
  return matches
}

function mergeRanges(matches: Match[], needle: string): Range[] {
  const span = countNewlines(needle, needle.length)
  const ranges: Range[] = []
  for (const { offset, line } of matches) {
    const startLine = Math.max(1, line - CONTEXT)
    const endLine = line + span + CONTEXT
    const last = ranges[ranges.length - 1]
    if (last && startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, endLine)
      last.offsets.push(offset)
    } else {
      ranges.push({ startLine, endLine, offsets: [offset] })
    }
  }
  return ranges
}

async function readRegions(target: string, ranges: Range[]): Promise<Region[]> {
  const regions: Region[] = ranges.map((range) => ({ ...range, startOffset: 0, text: "" }))
  let line = 1
  let index = 0
  let ri = 0
  for await (const chunk of normalizedChunks(target)) {
    let i = 0
    while (i < chunk.length && ri < regions.length) {
      const region = regions[ri]
      if (line > region.endLine) {
        ri += 1
        continue
      }
      const newline = chunk.indexOf("\n", i)
      const end = newline < 0 ? chunk.length : newline + 1
      if (line >= region.startLine) {
        if (!region.text) region.startOffset = index
        region.text += chunk.slice(i, end)
      }
      if (newline >= 0) line += 1
      index += end - i
      i = end
    }
    if (ri >= regions.length) break
  }
  return regions
}

async function writeSpliced(
  target: string,
  temp: string,
  offsets: number[],
  needleLength: number,
  replacement: string,
  lineBreak: string,
): Promise<void> {
  const handle = await open(temp, "w")
  try {
    let index = 0
    let next = 0
    let skip = 0
    for await (const chunk of normalizedChunks(target)) {
      let out = ""
      let i = 0
      while (i < chunk.length) {
        if (skip > 0) {
          const take = Math.min(skip, chunk.length - i)
          i += take
          index += take
          skip -= take
          continue
        }
        const stop = next < offsets.length ? offsets[next] : Infinity
        if (index === stop) {
          out += replacement
          skip = needleLength
          next += 1
          continue
        }
        const to = Math.min(chunk.length, i + (stop - index))
        out += chunk.slice(i, to)
        index += to - i
        i = to
      }
      if (out) await handle.write(Buffer.from(applyLineBreaks(out, lineBreak), "utf8"))
    }
  } finally {
    await handle.close()
  }
}

const spliceText = (
  text: string,
  offsets: number[],
  base: number,
  needleLength: number,
  replacement: string,
): string => {
  let out = ""
  let pos = 0
  for (const offset of offsets) {
    const at = offset - base
    out += text.slice(pos, at) + replacement
    pos = at + needleLength
  }
  return out + text.slice(pos)
}

function buildPatch(target: string, regions: Region[], needle: string, replacement: string): string {
  const hunks = regions.flatMap((region) => {
    const updated = spliceText(region.text, region.offsets, region.startOffset, needle.length, replacement)
    const delta = region.startLine - 1
    return structuredPatch(target, target, region.text, updated, "", "", { context: CONTEXT }).hunks.map(
      (hunk) => ({ ...hunk, oldStart: hunk.oldStart + delta, newStart: hunk.newStart + delta }),
    )
  })
  return formatPatch({ oldFileName: target, newFileName: target, oldHeader: "", newHeader: "", hunks })
}

export const editFileTool = defineTool({
  description: "Replace exact text in a file.",
  metadata: { icon: "edit" },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path, replace_all } = args
    const needle = normalizeLineBreaks(args.old_string)
    const replacement = normalizeLineBreaks(args.new_string)
    const target = path.resolve(ctx.cwd, file_path)

    if (needle === replacement) {
      throw new Error("old_string and new_string are identical.")
    }

    return withFileLock(target, async () => {
      const readAt = readAtFor(ctx.sessionId, target)
      if (readAt === undefined) {
        throw new Error("Read the file before editing it.")
      }
      if (Math.floor((await stat(target)).mtimeMs) > readAt) {
        throw new Error("The file was modified since you read it. Read it again before editing.")
      }

      const matches = await findMatches(target, needle)
      if (matches.length === 0) {
        throw new Error(`old_string not found in ${target}.`)
      }
      if (matches.length > 1 && !replace_all) {
        throw new Error(
          `old_string appears ${matches.length} times in ${target}. Add more surrounding context to make it unique, or set replace_all to true.`,
        )
      }

      const lineBreak = await sniffLineBreak(target)
      const regions = await readRegions(target, mergeRanges(matches, needle))
      const patch = buildPatch(target, regions, needle, replacement)

      const temp = `${target}.${process.pid}.tmp`
      try {
        await writeSpliced(target, temp, matches.map((match) => match.offset), needle.length, replacement, lineBreak)
        await rename(temp, target)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      markRead(ctx.sessionId, target, (await stat(target)).mtimeMs)

      return {
        kind: "diff" as const,
        path: target,
        patch,
        summary: replace_all ? `Edited ${target} (${matches.length} replacements).` : `Edited ${target}.`,
      }
    })
  },
  toModelOutput: (output) => ({ type: "text", value: output.summary }),
})
