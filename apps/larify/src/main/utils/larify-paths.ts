import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Pure-Node path helpers for the ~/.larify home directory.
// These intentionally avoid importing `electron` so they can be safely
// loaded inside `node:worker_threads` (context/embedding workers), where
// the Electron module resolution hook is unavailable.

// Dev-only override: set LARIFY_HOME to point ~/.larify (tasks/memory/plugins/workspace)
// at an empty directory for isolated testing. Unset in production -> falls back to homedir().
// 按调用时读取（而非模块加载时固化为常量）：便于测试在 import 之后设置 LARIFY_HOME 也能生效，
// 且运行时切换 home 目录无需重新加载模块。
const larifyHome = (): string => process.env.LARIFY_HOME || homedir()

export const larifyPath = (...segments: string[]): string =>
  join(larifyHome(), '.larify', ...segments)

export const toPosixPath = (path: string): string => path.replaceAll('\\', '/')

export const ensureLarifyPath = (...segments: string[]): string => {
  const path = larifyPath(...segments)
  mkdirSync(path, { recursive: true })
  return path
}

export const larifyWorkspacePath = (): string => ensureLarifyPath('workspace')
