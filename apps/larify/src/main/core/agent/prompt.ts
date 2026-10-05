import { Liquid } from 'liquidjs'
import { larifyPath, toPosixPath } from '../../utils/app-paths'

const liquid = new Liquid()

export function buildSystemPrompt(
  template: string,
  cwd: string,
  context: {
    plugins: Array<{ name: string; description: string }>
    skills: Array<{ name: string; path: string; description: string }>
  } = { plugins: [], skills: [] },
  /** 用户配置的记忆仓库地址；未配置时不注入该行（见 prompt.md 的条件渲染）。 */
  memoryRepo?: string
): string {
  const repo = memoryRepo?.trim()
  return liquid
    .parseAndRenderSync(template, {
      platform: platformName(),
      cwd,
      memoryDirectory: toPosixPath(larifyPath('memory')),
      taskDirectory: toPosixPath(larifyPath('tasks')),
      pluginsDirectory: toPosixPath(larifyPath('plugins')),
      // ⚠️ liquid 把空串当**真值**（实测 `{% if '' %}` 为真）⇒ 必须归一为 null，
      // 否则留空时模板会渲染出一对**空的**反引号。
      memoryRepository: repo || null,
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
