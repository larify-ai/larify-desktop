import { describe, expect, it } from 'vitest'
import { stripYamlFrontmatter } from '../../../../src/extensions/workspace/renderer/preview/markdown-utils'

describe('MarkdownPreview', () => {
  it('strips YAML frontmatter from the start of a document', () => {
    expect(stripYamlFrontmatter('---\ntitle: Notes\ntags:\n  - work\n---\n# Body')).toBe('# Body')
  })

  it('supports CRLF and a BOM', () => {
    expect(stripYamlFrontmatter('\uFEFF---\r\ntitle: Notes\r\n---\r\nBody')).toBe('Body')
  })

  it('does not remove horizontal rules or an unclosed header', () => {
    expect(stripYamlFrontmatter('---\nParagraph')).toBe('---\nParagraph')
    expect(stripYamlFrontmatter('Before\n---\nAfter')).toBe('Before\n---\nAfter')
  })

  it('keeps the document readable when the YAML header is invalid', () => {
    const markdown = '---\ntags: [\n---\n# Body'
    expect(stripYamlFrontmatter(markdown)).toBe(markdown)
  })
})
