import { Liquid } from 'liquidjs'
import template from './prompt.md?raw'

const liquid = new Liquid()

/** 渲染 nest 判据。parentTask 存在时追加"完成后回父任务"的收尾指示。 */
export function buildNestPrompt(taskFile: string, parentTask?: string): string {
  return liquid
    .parseAndRenderSync(template, {
      taskFile,
      parentClause: parentTask
        ? `, finally call \`agent_schedule_task\` with the parent task \`${parentTask}\``
        : ''
    })
    .trim()
}
