import { describe, expect, it } from 'vitest'
import { normalizeModelMarkdownLinks } from '../../../src/renderer/src/lib/model-markdown-links'

describe('normalizeModelMarkdownLinks', () => {
  it('normalizes a model-authored Windows absolute file destination', () => {
    expect(
      normalizeModelMarkdownLinks(
        '[file](D:\\Workspace\\larify-website\\.codex-stream-card-acceptance.txt)'
      )
    ).toBe('[file](D:/Workspace/larify-website/.codex-stream-card-acceptance.txt)')
  })

  it('supports angle-bracket destinations', () => {
    expect(normalizeModelMarkdownLinks('[file](<D:\\Workspace\\a b.txt>)')).toBe(
      '[file](<D:/Workspace/a b.txt>)'
    )
  })

  it('supports parentheses inside an angle-bracket destination', () => {
    expect(normalizeModelMarkdownLinks('[file](<D:\\Workspace\\reports (final)\\a.txt>)')).toBe(
      '[file](<D:/Workspace/reports (final)/a.txt>)'
    )
  })

  it('supports image destinations', () => {
    expect(normalizeModelMarkdownLinks('![image](D:\\Workspace\\image.png)')).toBe(
      '![image](D:/Workspace/image.png)'
    )
  })

  it('normalizes multiple links independently', () => {
    expect(
      normalizeModelMarkdownLinks('[first](C:\\one.txt) and [second](<d:\\two with spaces.txt>)')
    ).toBe('[first](C:/one.txt) and [second](<d:/two with spaces.txt>)')
  })

  it('leaves an incomplete streaming link unchanged', () => {
    const markdown = '[file](D:\\Workspace\\still-streaming'
    expect(normalizeModelMarkdownLinks(markdown)).toBe(markdown)
  })

  it('does not consume a Markdown link title as part of the path', () => {
    const markdown = '[file](D:\\Workspace\\file.txt "title\\with\\slashes")'
    expect(normalizeModelMarkdownLinks(markdown)).toBe(markdown)
  })

  it('is idempotent and preserves a directory trailing slash', () => {
    const markdown = '[directory](D:\\Workspace\\project\\)'
    const normalized = normalizeModelMarkdownLinks(markdown)

    expect(normalized).toBe('[directory](D:/Workspace/project/)')
    expect(normalizeModelMarkdownLinks(normalized)).toBe(normalized)
  })

  it('leaves plain text, relative paths, and URLs unchanged', () => {
    const markdown =
      'D:\\Workspace\\plain.txt [relative](src\\main.ts) [url](https://example.com/a)'
    expect(normalizeModelMarkdownLinks(markdown)).toBe(markdown)
  })
})
