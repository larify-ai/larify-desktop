import { Liquid } from 'liquidjs'
import template from './prompt.md?raw'

const liquid = new Liquid()

/**
 * 渲染 nest 判据：**只告诉模型"现在该完成哪个 task.md"**。
 *
 * "如何完成任务"（三阶段 Workflow、调度/回父）统一写在系统提示词 `agent/prompt.md`，
 * 不在判据里重复——避免两处指令不一致。因此这里只注入 `taskFile`，不再有 parentClause。
 */
export function buildNestPrompt(taskFile: string): string {
  return liquid.parseAndRenderSync(template, { taskFile }).trim()
}
