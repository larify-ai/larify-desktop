import { describe, expect, it } from 'vitest'
import { Marked } from 'marked'
import { gfmHeadingId } from 'marked-gfm-heading-id'
import Latex from '@ant-design/x-markdown/plugins/Latex'
import { stripYamlFrontmatter } from '../../../../src/extensions/workspace/renderer/preview/markdown-utils'

describe('MarkdownPreview', () => {
  it('uses the Marked extension for stable GitHub-style heading ids', () => {
    const html = new Marked({ ...gfmHeadingId(), extensions: Latex() }).parse(
      '# Hello World\n\n# Hello World\n\n$E = mc^2$'
    )
    expect(html).toContain('<h1 id="hello-world">')
    expect(html).toContain('<h1 id="hello-world-1">')
    expect(html).toContain('class="katex"')
  })

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
