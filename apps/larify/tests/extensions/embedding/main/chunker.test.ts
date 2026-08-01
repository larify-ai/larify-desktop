import { describe, expect, it } from 'vitest'
import {
  chunkMarkdown,
  MAX_CHUNK_TOKENS,
  type MarkdownEmbeddingDocument
} from '../../../../src/extensions/embedding/main/chunker'

const countTokens = (text: string): number => Array.from(text).length
const chunk = (document: MarkdownEmbeddingDocument): string[] =>
  chunkMarkdown(document, countTokens)

describe('Markdown embedding chunker', () => {
  it('requires trimmed document metadata', () => {
    expect(() => chunk({ name: '', description: 'Description', content: '' })).toThrow(
      'requires a name and description'
    )
    expect(() => chunk({ name: 'Name', description: ' ', content: '' })).toThrow(
      'requires a name and description'
    )
  })

  it('creates one metadata input followed by heading-aware content inputs', () => {
    expect(
      chunk({
        name: 'Qwen 本地部署',
        description: '使用 ONNX Runtime 在本地生成向量。',
        content: '# 安装\n\n安装依赖。\n\n## Windows\n\n运行桌面应用。'
      })
    ).toEqual([
      '# Qwen 本地部署\n\n使用 ONNX Runtime 在本地生成向量。',
      '安装\n\n安装依赖。\n\nWindows\n\n运行桌面应用。'
    ])
  })

  it('falls back to child headings only when the parent section is too large', () => {
    const windows = 'W'.repeat(350)
    const macos = 'M'.repeat(350)

    expect(
      chunk({
        name: 'Install',
        description: 'Platforms',
        content: `# Install\n\n## Windows\n\n${windows}\n\n## macOS\n\n${macos}`
      }).slice(1)
    ).toEqual([`Install\n\nWindows\n\n${windows}`, `Install\n\nmacOS\n\n${macos}`])
  })

  it('returns only the metadata input when the body is empty', () => {
    expect(
      chunk({
        name: 'Empty',
        description: 'No body',
        content: '# Heading only'
      })
    ).toEqual(['# Empty\n\nNo body'])
  })

  it('splits long sections without losing their content', () => {
    const body = '向量索引内容。'.repeat(300)
    const chunks = chunk({
      name: 'Long',
      description: 'Long document',
      content: `# Section\n\n${body}`
    }).slice(1)
    const prefix = 'Section\n\n'

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => countTokens(chunk) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(chunks.map((chunk) => chunk.slice(prefix.length)).join('')).toBe(body)
  })
})
