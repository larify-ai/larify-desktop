import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../../../src/main/core/agent/prompt'
import template from '../../../../src/main/core/agent/prompt.md?raw'

describe('buildSystemPrompt', () => {
  it('renders request-specific context', () => {
    const prompt = buildSystemPrompt(
      '{{ platform }}|{{ cwd }}|{{ memoryDirectory }}|{{ taskDirectory }}',
      'D:/workspace'
    )

    expect(prompt).toContain('D:/workspace')
    expect(prompt).toContain('memory')
    expect(prompt).toContain('tasks')
    expect(prompt).not.toContain('{{')
  })

  it('appends the memory repository to the knowledge directory line only when configured', () => {
    const repoLine = (prompt: string): string =>
      prompt.split('\n').find((line) => line.startsWith('- The knowledge directory')) ?? ''

    // 配置后：在 knowledge directory 同一行末尾追加「(push to remote repository …)」。
    const repo = 'https://github.com/user/memory.git'
    const withRepo = buildSystemPrompt(template, 'cwd', undefined, repo)
    expect(repoLine(withRepo)).toContain(`(push to remote private repository \`${repo}\`)`)

    // 未配置 / 空白 ⇒ 该行只留原本的句号（无括号、无多余空格）。⚠️ liquid 把空串当**真值**，
    // 故缺省必须归一为 null，否则会渲染出一对**空的**反引号——这里就是该不变量的守门。
    const without = buildSystemPrompt(template, 'cwd')
    expect(repoLine(without)).not.toContain('remote private repository')
    // 该行以「memory 目录路径」+ 句号结尾，括号块整段不渲染。
    expect(repoLine(without)).toMatch(/`[^`]+`\.$/)
    // ★ 空串是**生产真值**（未配置时 readMemoryRepo() 返回 `''`，不是 undefined）⇒ 必须显式覆盖：
    // liquid 把空串当真值，若不归一就会渲染成「`push to remote private repository `` `」。
    expect(buildSystemPrompt(template, 'cwd', undefined, '')).toBe(without)
    expect(buildSystemPrompt(template, 'cwd', undefined, '   ')).toBe(without)
    // 内联追加 ⇒ 行数不变（未配置时与旧行为逐字节一致，零回归）。
    expect(withRepo.split('\n').length - without.split('\n').length).toBe(0)
  })

  it('renders plugins and eager skills', () => {
    const prompt = buildSystemPrompt(
      '{% for plugin in plugins %}{{ plugin.name }}:{{ plugin.description }}{% endfor %}|{% for skill in skills %}{{ skill.name }}:{{ skill.path }}{% endfor %}',
      'cwd',
      {
        plugins: [{ name: 'files', description: 'Files (2 tools, 1 skills)' }],
        skills: [{ name: 'files_review', path: 'review/SKILL.md', description: 'Review' }]
      }
    )

    expect(prompt).toBe('files:Files (2 tools, 1 skills)|files_review:review/SKILL.md')
  })
})
