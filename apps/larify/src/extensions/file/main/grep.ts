import { stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { trimTrailingLineBreak } from "../../../main/utils/text"
import type { Tool } from "../../../shared/tool"
import { runRipgrepStream, toAbsolutePath } from "./ripgrep"

const DEFAULT_TIMEOUT_MS = 10 * 60_000

const inputSchema = z.object({
  pattern: z.string().describe("The regex pattern to search for in file contents"),
  path: z.string().optional().describe("The file or directory to search in. If omitted, the session working directory is used."),
  glob: z.string().optional().describe("The glob pattern to filter files"),
  limit: z.number().int().positive().default(50).describe("Maximum number of matching files to return"),
  offset: z.number().int().nonnegative().default(0).describe("Skip the first N matching files"),
})

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
    lines: { text: string }
    line_number: number
  }
}

const isRipgrepMatch = (value: unknown): value is RipgrepMatch => {
  if (!value || typeof value !== "object") return false
  const record = value as RipgrepMatch
  return (
    record.type === "match" &&
    typeof record.data?.path?.text === "string" &&
    typeof record.data?.lines?.text === "string" &&
    typeof record.data?.line_number === "number"
  )
}

const parseMatch = (root: string, line: string): Match | null => {
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRipgrepMatch(json)) return null
  return {
    filePath: toAbsolutePath(root, json.data.path.text),
    lineNumber: json.data.line_number,
    text: trimTrailingLineBreak(json.data.lines.text),
  }
}

const formatFileMatches = (groups: FileMatches[], offset: number, truncated: boolean): string => {
  const body = groups
    .map((group) => {
      const lines = group.matches.map((match) => `${match.lineNumber}: ${match.text}`)
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
  offset: number,
  limit: number,
): Promise<{ groups: FileMatches[]; truncated: boolean }> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const groups: FileMatches[] = []
  const byFile = new Map<string, FileMatches>()
  const seenFiles = new Set<string>()
  let skipped = 0
  let truncated = false

  try {
    await runRipgrepStream(rgArgs, root, controller.signal, (lines) => {
      for (const line of lines) {
        const match = parseMatch(root, line)
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
        group.matches.push(match)
      }
    })
  } catch (error) {
    if (groups.length === 0) throw error
    truncated = true
  } finally {
    clearTimeout(timeout)
  }

  return { groups, truncated: truncated || controller.signal.aborted }
}

export const grepFilesTool: Tool = {
  name: "grep",
  description: "Search file contents.",
  metadata: { icon: "search" },
  inputSchema,
  execute: async (args, ctx) => {
    const { pattern, path: searchPath, glob, limit, offset } = inputSchema.parse(args)
    const root = path.resolve(searchPath ?? ctx.cwd ?? process.cwd())
    await stat(root)

    const rgArgs = ["--no-config", "--json", "--hidden", "--no-messages", "--glob", "!**/.git/**"]
    if (glob) rgArgs.push("--glob", glob)
    if (pattern.startsWith("-")) rgArgs.push("-e", pattern)
    else rgArgs.push(pattern)

    const { groups, truncated } = await readMatchGroups(rgArgs, root, offset, limit)
    if (groups.length === 0) return "No matches found."

    return formatFileMatches(groups, offset, truncated)
  },
}
