import { describe, expect, it } from 'vitest'
import { readMarkdownSections } from '../../../../src/extensions/embedding/main/markdown-sections'

describe('Markdown sections', () => {
  it('tracks nested headings and merges adjacent blocks in the same section', () => {
    expect(
      readMarkdownSections(
        '# Install\n\nFirst.\n\nSecond.\n\n## Windows\n\nWindows content.\n\n# Search\n\nSearch content.'
      )
    ).toEqual([
      { headingPath: ['Install'], content: 'First.\n\nSecond.' },
      { headingPath: ['Install', 'Windows'], content: 'Windows content.' },
      { headingPath: ['Search'], content: 'Search content.' }
    ])
  })

  it('keeps content before the first heading', () => {
    expect(readMarkdownSections('Introduction.\n\n# Details\n\nBody.')).toEqual([
      { headingPath: [], content: 'Introduction.' },
      { headingPath: ['Details'], content: 'Body.' }
    ])
  })

  it('handles skipped and decreasing heading levels without empty path segments', () => {
    expect(readMarkdownSections('# A\n\n### C\n\nDeep.\n\n## B\n\nMiddle.')).toEqual([
      { headingPath: ['A', 'C'], content: 'Deep.' },
      { headingPath: ['A', 'B'], content: 'Middle.' }
    ])
  })

  it('does not treat headings inside fenced code as document headings', () => {
    expect(readMarkdownSections('# Code\n\n```md\n# Not a heading\n```')).toEqual([
      { headingPath: ['Code'], content: '```md\n# Not a heading\n```' }
    ])
  })

  it('returns no sections for empty or heading-only Markdown', () => {
    expect(readMarkdownSections('')).toEqual([])
    expect(readMarkdownSections('# Empty')).toEqual([])
  })
})
