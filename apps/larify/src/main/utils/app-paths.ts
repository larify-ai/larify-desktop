import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { app } from "electron"

export const larifyPath = (...segments: string[]): string =>
  join(homedir(), ".larify", ...segments)

export const ensureLarifyPath = (...segments: string[]): string => {
  const path = larifyPath(...segments)
  mkdirSync(path, { recursive: true })
  return path
}

export const larifyWorkspacePath = (): string => ensureLarifyPath("workspace")

export const resourcePath = (...segments: string[]): string => {
  const root = app.isPackaged ? process.resourcesPath : join(process.cwd(), "resources")
  return join(root, ...segments)
}
