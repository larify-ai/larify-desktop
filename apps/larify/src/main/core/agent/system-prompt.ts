import { Liquid } from 'liquidjs'
import type { ExtensionHost } from '../extension'
import { larifyPath } from '../../utils/app-paths'

const liquid = new Liquid()

function platformName(): string {
  if (process.platform === 'win32') return 'Windows'
  if (process.platform === 'darwin') return 'macOS'
  if (process.platform === 'linux') return 'Linux'
  return process.platform
}

export function buildSystemPrompt(
  template: string,
  host: ExtensionHost,
  cwd: string,
  additionalPrompt?: string
): string {
  const prompt = liquid
    .parseAndRenderSync(template, {
      plugins: host.listPlugins(),
      skills: host.eagerSkills(),
      platform: platformName(),
      cwd,
      taskDirectory: larifyPath('tasks')
    })
    .trim()
  return additionalPrompt ? `${prompt}\n\n${additionalPrompt.trim()}` : prompt
}
