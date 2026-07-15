import { homedir } from "node:os"
import { join } from "node:path"

export const larifyPath = (...segments: string[]): string =>
  join(homedir(), ".larify", ...segments)
