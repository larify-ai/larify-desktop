import { execFile } from "node:child_process"
import path from "node:path"
import { rgPath } from "@vscode/ripgrep"
import { splitLines } from "../../../main/utils/text"

const MAX_BUFFER = 128 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000

const parseRipgrepLines = (stdout: string): string[] =>
  splitLines(stdout.trim()).filter(Boolean)

export function runRipgrep(args: string[], target: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      rgPath,
      [...args, target],
      {
        maxBuffer: MAX_BUFFER,
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error || error.code === 1) {
          resolve(parseRipgrepLines(stdout))
          return
        }
        reject(error)
      },
    )
  })
}

export const toAbsolutePath = (basePath: string, value: string): string =>
  path.isAbsolute(value) ? value : path.join(basePath, value)
