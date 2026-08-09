import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../../../src/main/core/agent/prompt'

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
