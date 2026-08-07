import { Liquid } from 'liquidjs'
import { larifyPath } from '../../utils/app-paths'

const liquid = new Liquid()

export function buildSystemPrompt(template: string, cwd: string): string {
  return liquid
    .parseAndRenderSync(template, {
      platform: platformName(),
      cwd,
      workingMemoryDirectory: larifyPath('working-memory'),
      longTermMemoryDirectory: larifyPath('long-term-memory'),
      plugins: [],
      skills: []
    })
    .trim()
}

function platformName(): string {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  if (process.platform === 'linux') return 'Linux'
  return process.platform
}
