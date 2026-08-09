import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import iconv from 'iconv-lite'
import { z } from 'zod'
import { trimTrailingLineBreak } from '../../../main/utils/text'
import { defineTool } from '../../../main/core/plugin/protocol'
import { guessEncoding } from './encoding'
import { runRipgrepStream, toAbsolutePath } from './ripgrep'

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const FILE_MATCH_LIMIT = 3
const LINE_LIMIT = 100
const SAMPLE_BYTES = 1 << 16

const inputSchema = z
  .object({
    pattern: z.string().describe('The regex pattern to search for in file contents'),
    path: z
      .string()
      .optional()
      .describe(
        'The file or directory to search in. If omitted, the current working directory is used.'
      ),
    glob: z.string().optional().describe('Glob pattern, relative to the search directory'),
    limit: z
      .number()
      .int()
      .positive()
      .max(1000)
      .default(100)
      .describe('Maximum number of matching files to return'),
    offset: z.number().int().nonnegative().default(0).describe('Skip the first N matching files')
  })
  .strict()

interface Match {
  filePath: string
  lineNumber: number
  text: string
  bytes?: string
}

interface FileMatches {
  filePath: string
  matches: Match[]
  hasMore: boolean
}

interface RipgrepMatch {
  type: 'match'
  data: {
    path: { text: string }
    lines: { text?: string; bytes?: string }
    line_number: number
  }
}

const isRipgrepMatch = (value: unknown): value is RipgrepMatch => {
  if (!value || typeof value !== 'object') return false
  const record = value as RipgrepMatch
  return (
    record.type === 'match' &&
    typeof record.data?.path?.text === 'string' &&
    typeof record.data?.line_number === 'number'
  )
}

const clampLine = (text: string): string => {
  const trimmed = trimTrailingLineBreak(text)
  return trimmed.length > LINE_LIMIT ? `${trimmed.slice(0, LINE_LIMIT)}…` : trimmed
}

const parseMatch = (root: string, line: string): Match | null => {
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRipgrepMatch(json)) return null
  const filePath = toAbsolutePath(root, json.data.path.text)
  const lineNumber = json.data.line_number
  const { text, bytes } = json.data.lines
  if (typeof text === 'string') return { filePath, lineNumber, text: clampLine(text) }
  return { filePath, lineNumber, text: '', bytes }
}

async function fileEncoding(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(SAMPLE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, SAMPLE_BYTES, 0)
    return guessEncoding(buffer.subarray(0, bytesRead)).trusted ?? 'utf-8'
  } finally {
    await handle.close()
  }
}

async function resolvePendingText(groups: FileMatches[]): Promise<void> {
  const encoding = new Map<string, string>()
  for (const group of groups) {
    for (const match of group.matches) {
      if (match.bytes === undefined) continue
      let enc = encoding.get(match.filePath)
      if (enc === undefined) {
        enc = await fileEncoding(match.filePath).catch(() => 'utf-8')
        encoding.set(match.filePath, enc)
      }
      match.text = clampLine(iconv.decode(Buffer.from(match.bytes, 'base64'), enc))
    }
  }
}

const formatFileMatches = (groups: FileMatches[], offset: number, truncated: boolean): string => {
  const body = groups
    .map((group) => {
      const lines = group.matches.map((match) => `${match.lineNumber}: ${match.text}`)
      if (group.hasMore) lines.push('…')
      return [group.filePath, ...lines].join('\n')
    })
    .join('\n\n')

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
  signal?: AbortSignal
): Promise<{ groups: FileMatches[]; truncated: boolean }> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const onExternalAbort = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const groups: FileMatches[] = []
  const byFile = new Map<string, FileMatches>()
  const seenFiles = new Set<string>()
  let skipped = 0
  let truncated = false

  try {
    await runRipgrepStream(rgArgs, root, controller.signal, cwd, (lines) => {
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
          group = { filePath: match.filePath, matches: [], hasMore: false }
          byFile.set(match.filePath, group)
          groups.push(group)
        }
        if (group.matches.length < FILE_MATCH_LIMIT) group.matches.push(match)
        else group.hasMore = true
      }
    })
  } catch (error) {
    if (groups.length === 0) throw error
    truncated = true
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onExternalAbort)
  }

  await resolvePendingText(groups)
  return { groups, truncated: truncated || controller.signal.aborted }
}

const rgArgs = (pattern: string, glob?: string): string[] => [
  '--no-config',
  '--json',
  '--hidden',
  '--no-messages',
  '--sort=path',
  '--glob',
  '!**/.git/**',
  ...(glob ? ['--glob', glob] : []),
  ...(pattern.startsWith('-') ? ['-e', pattern] : [pattern])
]

export const grepFilesTool = defineTool({
  description: `Search file contents, by running: rg ${rgArgs('<pattern>', '<glob>').join(' ')} <path>`,
  metadata: { icon: 'search', eager: true },
  inputSchema,
  execute: async (args, ctx) => {
    const { pattern, path: searchPath, glob, limit, offset } = args
    const root = path.resolve(ctx.cwd, searchPath ?? '.')
    const stats = await stat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return String(error)
      throw error
    })
    if (typeof stats === 'string') return stats
    const rgCwd = stats.isDirectory() ? root : path.dirname(root)

    const { groups, truncated } = await readMatchGroups(
      rgArgs(pattern, glob),
      root,
      rgCwd,
      offset,
      limit,
      ctx.signal
    )
    if (groups.length === 0) {
      return truncated
        ? 'Search stopped before any match was found. Narrow the search.'
        : 'No matches found.'
    }

    return formatFileMatches(groups, offset, truncated)
  }
})
