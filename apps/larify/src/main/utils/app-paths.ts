import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const larifyPath = (...segments: string[]): string =>
  join(homedir(), ".larify", ...segments)

export const ensureLarifyPath = (...segments: string[]): string => {
  const path = larifyPath(...segments)
  mkdirSync(path, { recursive: true })
  return path
}

export const larifyWorkspacePath = (): string => ensureLarifyPath("workspace")
