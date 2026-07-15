import { stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { Tool } from "../../../shared/tool"
import { runRipgrep, toAbsolutePath } from "./ripgrep"

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
  const json = JSON.parse(line) as unknown
  if (!isRipgrepMatch(json)) return null
  return {
    filePath: toAbsolutePath(root, json.data.path.text),
    lineNumber: json.data.line_number,
    text: json.data.lines.text.replace(/\r?\n$/, ""),
  }
}

const groupMatchesByFile = (matches: Match[]): FileMatches[] => {
  const byFile = new Map<string, Match[]>()
  for (const match of matches) {
    byFile.set(match.filePath, [...(byFile.get(match.filePath) ?? []), match])
  }
  return [...byFile].map(([filePath, fileMatches]) => ({ filePath, matches: fileMatches }))
}

const formatFileMatches = (groups: FileMatches[], offset: number, end: number, total: number): string => {
  const body = groups
    .map((group) => {
      const lines = group.matches.map((match) => `${match.lineNumber}: ${match.text}`)
      return [group.filePath, ...lines].join("\n")
    })
    .join("\n\n")

  let output = body
  if (offset > 0) output = `(Matching files 1-${offset} omitted.)\n\n${output}`
  if (end < total) output += `\n\n(Matching files ${end + 1}-${total} omitted.)`
  return output
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

    const lines = await runRipgrep(rgArgs, root)
    const matches = lines.map((line) => parseMatch(root, line)).filter((match): match is Match => match !== null)
    const groups = groupMatchesByFile(matches)

    if (groups.length === 0) return "No matches found."

    const end = Math.min(groups.length, offset + limit)
    return formatFileMatches(groups.slice(offset, end), offset, end, groups.length)
  },
}
