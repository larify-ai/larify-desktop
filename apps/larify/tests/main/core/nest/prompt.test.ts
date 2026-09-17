import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyPath: (name: string) => `C:\\root\\.larify\\${name}`
}))

import { buildNestPrompt, parentTaskFile } from '../../../../src/main/core/nest/prompt'

// 分隔符统一为正斜杠；大小写保持原样（Linux 路径大小写敏感，不能折叠）。
const tasks = 'C:/root/.larify/tasks'

describe('parentTaskFile', () => {
  it('returns undefined for a root task (task.md directly under the tasks directory)', () => {
    expect(parentTaskFile(`${tasks}/编写三个文件/task.md`)).toBeUndefined()
  })

  it('returns the parent task.md for a nested task', () => {
    expect(parentTaskFile(`${tasks}/编写三个文件/子任务/task.md`)).toBe(
      `${tasks}/编写三个文件/task.md`
    )
  })

  it('normalizes the separator so a model-supplied posix path still resolves', () => {
    // 模型常给正斜杠路径，而 larifyPath 在 Windows 用反斜杠——只归一分隔符即可比较。
    expect(parentTaskFile('C:\\root\\.larify\\tasks\\甲\\乙\\task.md')).toBe(`${tasks}/甲/task.md`)
  })

  it('keeps the original casing (Linux paths are case-sensitive)', () => {
    // 大小写折叠会让 `/home/Alice/...` 与 `/home/alice/...` 被判为同一个 tasks 根，
    // 于子任务被误当根任务（不注入父路径）、多层嵌套失效。注入的父路径也必须保持原样。
    expect(parentTaskFile('/home/Alice/.larify/tasks/A/B/task.md')).toBe(
      '/home/Alice/.larify/tasks/A/task.md'
    )
  })
})

describe('buildNestPrompt', () => {
  it('renders the task path and the workflow steps without leftover template variables', () => {
    const prompt = buildNestPrompt('C:/tasks/root/child/task.md')

    expect(prompt).toContain('C:/tasks/root/child/task.md')
    expect(prompt).toContain('workflow')
    // 模板变量必须全部渲染。
    expect(prompt).not.toContain('{{')
  })

  it('adds no parent clause for a root task (sentence ends after the status step)', () => {
    // 根任务没有父——不得出现「调度父任务」的收尾从句，否则模型会去调度一个不存在的任务。
    const prompt = buildNestPrompt(`${tasks}/编写三个文件/task.md`)

    expect(prompt).not.toContain('the parent task.md path')
    expect(prompt.endsWith("in the current task's task.md.")).toBe(true)
  })

  it('names the concrete parent task.md so “returning to the parent” is deterministic', () => {
    // 曾经由模型自行猜测父路径 → 猜成自己 → 无限重入。这里必须给出**确定的**父路径。
    const prompt = buildNestPrompt(`${tasks}/编写三个文件/子任务/task.md`)

    expect(prompt).toContain(`the parent task.md path \`${tasks}/编写三个文件/task.md\``)
    expect(prompt.endsWith('to set status to `in_progress`.')).toBe(true)
  })

  it('accepts an explicit parent override (used to render a sub-task clause)', () => {
    const prompt = buildNestPrompt(`${tasks}/甲/乙/task.md`, `${tasks}/甲/task.md`)

    expect(prompt).toContain(`the parent task.md path \`${tasks}/甲/task.md\``)
  })
})
