import { readFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { trimTrailingLineBreak } from "../../../main/utils/text"
import { defineTool } from "../../../shared/tool"
import { decodeText } from "./encoding"
import { runRipgrepStream, toAbsolutePath } from "./ripgrep"

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const FILE_MATCH_LIMIT = 3
const LINE_LIMIT = 100

const inputSchema = z.object({
  pattern: z.string().describe("The regex pattern to search for in file contents"),
  path: z.string().optional().describe("The file or directory to search in. If omitted, the current working directory is used."),
  glob: z.string().optional().describe("Glob pattern, relative to the search directory"),
  limit: z.number().int().positive().default(100).describe("Maximum number of matching files to return"),
  offset: z.number().int().nonnegative().default(0).describe("Skip the first N matching files"),
}).strict()

interface Match {
  filePath: string
  lineNumber: number
  text: string
}

interface FileMatches {
  filePath: string
  matches: Match[]
}

interface RipgrepMatch {
  type: "match"
  data: {
    path: { text: string }
    lines: { text?: string }
    line_number: number
  }
}

const isRipgrepMatch = (value: unknown): value is RipgrepMatch => {
  if (!value || typeof value !== "object") return false
  const record = value as RipgrepMatch
  return (
    record.type === "match" &&
    typeof record.data?.path?.text === "string" &&
    typeof record.data?.line_number === "number"
  )
}

const decodedFileLines = (filePath: string, cache: Map<string, string[]>): string[] => {
  let lines = cache.get(filePath)
  if (!lines) {
    try {
      lines = decodeText(readFileSync(filePath)).split("\n")
    } catch {
      lines = []
    }
    cache.set(filePath, lines)
  }
  return lines
}

const parseMatch = (root: string, line: string, cache: Map<string, string[]>): Match | null => {
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRipgrepMatch(json)) return null
  const filePath = toAbsolutePath(root, json.data.path.text)
  const lineNumber = json.data.line_number
  const text = trimTrailingLineBreak(
    json.data.lines?.text ?? decodedFileLines(filePath, cache)[lineNumber - 1] ?? "",
  )
  return {
    filePath,
    lineNumber,
    text: text.length > LINE_LIMIT ? `${text.slice(0, LINE_LIMIT)}…` : text,
  }
}

const formatFileMatches = (groups: FileMatches[], offset: number, truncated: boolean): string => {
  const body = groups
    .map((group) => {
      const lines = group.matches.map((match) => `${match.lineNumber}: ${match.text}`)
      if (group.matches.length >= FILE_MATCH_LIMIT) lines.push("…")
      return [group.filePath, ...lines].join("\n")
    })
    .join("\n\n")

  let output = body
  if (truncated) {
    output += `\n\n(More results omitted; use offset ${offset + groups.length} to continue or narrow the search.)`
  }
  return output
}

const readMatchGroups = async (
  rgArgs: string[],
  root: string,
  cwd: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<{ groups: FileMatches[]; truncated: boolean }> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const onExternalAbort = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", onExternalAbort, { once: true })
  }
  const groups: FileMatches[] = []
  const byFile = new Map<string, FileMatches>()
  const seenFiles = new Set<string>()
  const decodedLines = new Map<string, string[]>()
  let skipped = 0
  let truncated = false

  try {
    await runRipgrepStream(rgArgs, root, controller.signal, cwd, (lines) => {
      for (const line of lines) {
        const match = parseMatch(root, line, decodedLines)
        if (!match) continue

        let group = byFile.get(match.filePath)
        if (!group) {
          if (!seenFiles.has(match.filePath)) {
            seenFiles.add(match.filePath)
            if (skipped < offset) {
              skipped += 1
              continue
            }
          } else {
            continue
          }
          if (groups.length >= limit) {
            truncated = true
            controller.abort()
            return
          }
          group = { filePath: match.filePath, matches: [] }
          byFile.set(match.filePath, group)
          groups.push(group)
        }
        if (group.matches.length < FILE_MATCH_LIMIT) group.matches.push(match)
      }
    })
  } catch (error) {
    if (groups.length === 0) throw error
    truncated = true
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", onExternalAbort)
  }

  return { groups, truncated: truncated || controller.signal.aborted }
}

const rgArgs = (pattern: string, glob?: string): string[] => [
  "--no-config",
  "--json",
  "--hidden",
  "--no-messages",
  "--sort=path",
  "--glob",
  "!**/.git/**",
  ...(glob ? ["--glob", glob] : []),
  ...(pattern.startsWith("-") ? ["-e", pattern] : [pattern]),
]

export const grepFilesTool = defineTool({
  description: `Search file contents, by running: rg ${rgArgs("<pattern>", "<glob>").join(" ")} <path>`,
  metadata: { icon: "search" },
  inputSchema,
  execute: async (args, ctx) => {
    const { pattern, path: searchPath, glob, limit, offset } = args
    const root = path.resolve(ctx.cwd, searchPath ?? ".")
    const stats = await stat(root)
    const rgCwd = stats.isDirectory() ? root : path.dirname(root)

    const { groups, truncated } = await readMatchGroups(
      rgArgs(pattern, glob),
      root,
      rgCwd,
      offset,
      limit,
      ctx.signal,
    )
    if (groups.length === 0) {
      return truncated
        ? "Search stopped before any match was found. Narrow the search."
        : "No matches found."
    }

    return formatFileMatches(groups, offset, truncated)
  },
})
