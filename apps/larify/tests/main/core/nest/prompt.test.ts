import { describe, expect, it } from 'vitest'
import { buildNestPrompt } from '../../../../src/main/core/nest/prompt'

describe('buildNestPrompt', () => {
  it('renders only the task path (task-specific guidance lives in the system prompt)', () => {
    const prompt = buildNestPrompt('C:/tasks/root/child/task.md')

    // 判据只告诉模型「完成哪个 task.md」——如何完成（三阶段 Workflow、调度、回父）
    // 统一在系统提示词 agent/prompt.md，不在判据里重复。
    expect(prompt).toContain('C:/tasks/root/child/task.md')
    expect(prompt).toContain('workflow')
    // 无 parentClause / 无遗留模板变量。
    expect(prompt).not.toContain('parent')
    expect(prompt).not.toContain('{{')
  })
})
