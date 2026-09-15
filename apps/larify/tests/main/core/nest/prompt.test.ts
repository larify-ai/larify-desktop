import { describe, expect, it } from 'vitest'
import { buildNestPrompt } from '../../../../src/main/core/nest/prompt'

describe('buildNestPrompt', () => {
  it('renders the task path and the single-task constraint without a parent clause', () => {
    const prompt = buildNestPrompt('C:/tasks/root/child/task.md')

    expect(prompt).toContain('C:/tasks/root/child/task.md')
    // 单任务约束：一轮只调一次 schedule_task。
    expect(prompt).toContain('only once')
    // 无 parentTask 时不含"回父"收尾指示。
    expect(prompt).not.toContain('parent task')
    // 模板变量必须全部被渲染。
    expect(prompt).not.toContain('{{')
  })

  it('appends the return-to-parent clause when a parent task is provided', () => {
    const prompt = buildNestPrompt('C:/tasks/root/child/task.md', 'C:/tasks/root/task.md')

    expect(prompt).toContain('C:/tasks/root/child/task.md')
    expect(prompt).toContain('agent_schedule_task')
    expect(prompt).toContain('C:/tasks/root/task.md')
    expect(prompt).toContain('parent task')
  })

})
