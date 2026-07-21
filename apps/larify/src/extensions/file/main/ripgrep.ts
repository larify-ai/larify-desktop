import { spawn } from "node:child_process"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import { rgPath } from "@vscode/ripgrep"
import { splitLines } from "../../../main/utils/text"

const DEFAULT_TIMEOUT_MS = 10 * 60_000

interface RunRipgrepOptions {
  offset?: number
  limit?: number
  signal?: AbortSignal
}

interface RunRipgrepResult {
  lines: string[]
  truncated: boolean
}

export function runRipgrepStream(
  args: string[],
  target: string,
  signal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let remainder = ""
    let settled = false
    const decoder = new StringDecoder("utf8")
    let stderr = ""

    const child = spawn(rgPath, [...args, target], {
      signal,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
    }
    const onAbort = (): void => settle(resolve)
    signal.addEventListener("abort", onAbort, { once: true })

    child.stdout?.on("data", (chunk: Buffer) => {
      const data = remainder + decoder.write(chunk)
      const parts = splitLines(data)
      remainder = parts.pop() ?? ""
      const lines = parts.filter(Boolean)
      if (lines.length) onLines(lines)
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      signal.removeEventListener("abort", onAbort)
      if (signal.aborted) {
        settle(resolve)
        return
      }
      settle(() => reject(error))
    })

    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort)
      settle(() => {
        remainder += decoder.end()
        if (remainder) {
          const lines = splitLines(remainder).filter(Boolean)
          if (lines.length) onLines(lines)
        }
        if (code === 0 || code === 1) {
          resolve()
          return
        }
        const detail = stderr.trim()
        reject(new Error(detail ? `ripgrep exited with code ${code}: ${detail}` : `ripgrep exited with code ${code}`))
      })
    })
  })
}

export async function runRipgrepLimited(
  args: string[],
  target: string,
  options: RunRipgrepOptions = {},
): Promise<RunRipgrepResult> {
  const offset = options.offset ?? 0
  const limit = options.limit
  const lines: string[] = []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  const onExternalAbort = (): void => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener("abort", onExternalAbort, { once: true })
  }
  let seen = 0
  let truncated = false

  try {
    await runRipgrepStream(args, target, controller.signal, (chunkLines) => {
      for (const line of chunkLines) {
        if (seen < offset) {
          seen += 1
          continue
        }
        if (limit !== undefined && lines.length >= limit) {
          truncated = true
          controller.abort()
          return
        }
        lines.push(line)
        seen += 1
      }
    })
  } catch (error) {
    if (!controller.signal.aborted && lines.length === 0) throw error
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", onExternalAbort)
  }

  return { lines, truncated: truncated || controller.signal.aborted }
}

export async function runRipgrep(args: string[], target: string): Promise<string[]> {
  const { lines } = await runRipgrepLimited(args, target)
  return lines
}

export const toAbsolutePath = (basePath: string, value: string): string =>
  path.isAbsolute(value) ? value : path.join(basePath, value)
