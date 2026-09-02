import { Liquid } from 'liquidjs'
import { larifyPath, toPosixPath } from '../../utils/app-paths'

const liquid = new Liquid()

export function buildSystemPrompt(
  template: string,
  cwd: string,
  context: {
    plugins: Array<{ name: string; description: string }>
    skills: Array<{ name: string; path: string; description: string }>
  } = { plugins: [], skills: [] }
): string {
  return liquid
    .parseAndRenderSync(template, {
      platform: platformName(),
      cwd,
      memoryDirectory: toPosixPath(larifyPath('memory')),
      taskDirectory: toPosixPath(larifyPath('tasks')),
      pluginsDirectory: toPosixPath(larifyPath('plugins')),
      ...context
    })
    .trim()
}

function platformName(): string {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  if (process.platform === 'linux') return 'Linux'
  return process.platform
}
