import { describe, expect, it } from 'vitest'
import { readMarkdownSections } from '../../../../src/extensions/embedding/main/markdown-sections'

describe('Markdown sections', () => {
  it('tracks nested headings and merges adjacent blocks in the same section', () => {
    expect(
      readMarkdownSections(
        '# Install\n\nFirst.\n\nSecond.\n\n## Windows\n\nWindows content.\n\n# Search\n\nSearch content.'
      )
    ).toEqual([
      { headingPath: ['Install'], blocks: ['First.', 'Second.'] },
      { headingPath: ['Install', 'Windows'], blocks: ['Windows content.'] },
      { headingPath: ['Search'], blocks: ['Search content.'] }
    ])
  })

  it('keeps content before the first heading', () => {
    expect(readMarkdownSections('Introduction.\n\n# Details\n\nBody.')).toEqual([
      { headingPath: [], blocks: ['Introduction.'] },
      { headingPath: ['Details'], blocks: ['Body.'] }
    ])
  })

  it('handles skipped and decreasing heading levels without empty path segments', () => {
    expect(readMarkdownSections('# A\n\n### C\n\nDeep.\n\n## B\n\nMiddle.')).toEqual([
      { headingPath: ['A', 'C'], blocks: ['Deep.'] },
      { headingPath: ['A', 'B'], blocks: ['Middle.'] }
    ])
  })

  it('does not treat headings inside fenced code as document headings', () => {
    expect(readMarkdownSections('# Code\n\n```md\n# Not a heading\n```')).toEqual([
      { headingPath: ['Code'], blocks: ['```md\n# Not a heading\n```'] }
    ])
  })

  it('keeps blank lines inside a Markdown block', () => {
    expect(readMarkdownSections('# Code\n\n```js\nconst a = 1\n\nconst b = 2\n```')).toEqual([
      {
        headingPath: ['Code'],
        blocks: ['```js\nconst a = 1\n\nconst b = 2\n```']
      }
    ])
  })

  it('recognizes Setext headings', () => {
    expect(
      readMarkdownSections('Install\n=======\n\nBody.\n\nWindows\n-------\n\nDetails.')
    ).toEqual([
      { headingPath: ['Install'], blocks: ['Body.'] },
      { headingPath: ['Install', 'Windows'], blocks: ['Details.'] }
    ])
  })

  it('uses plain text for formatted heading paths and preserves body Markdown', () => {
    expect(
      readMarkdownSections(
        '# **Audio** [Driver](./driver.md)\n\n> Keep this quote.\n\n- first\n- second'
      )
    ).toEqual([
      {
        headingPath: ['Audio Driver'],
        blocks: ['> Keep this quote.', '- first\n- second']
      }
    ])
  })

  it('preserves indentation in indented code blocks', () => {
    expect(readMarkdownSections('# Code\n\n    const value = 1\n    console.log(value)')).toEqual([
      {
        headingPath: ['Code'],
        blocks: ['    const value = 1\n    console.log(value)']
      }
    ])
  })

  it('retains parent headings across empty sections', () => {
    expect(readMarkdownSections('# Parent\n\n## Child\n\nContent.')).toEqual([
      { headingPath: ['Parent', 'Child'], blocks: ['Content.'] }
    ])
  })

  it('returns no sections for empty or heading-only Markdown', () => {
    expect(readMarkdownSections('')).toEqual([])
    expect(readMarkdownSections('# Empty')).toEqual([])
  })
})
