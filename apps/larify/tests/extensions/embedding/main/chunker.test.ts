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
  it('uses whichever metadata fields are available', () => {
    expect(chunk({ name: '', description: 'Description', content: '' })).toEqual(['Description'])
    expect(chunk({ name: 'Name', description: ' ', content: '' })).toEqual(['# Name'])
    expect(chunk({ name: '', description: '', content: '# Body\n\nContent' })).toEqual([
      'Body\n\nContent'
    ])
  })

  it('trims metadata before rendering it', () => {
    expect(chunk({ name: '  Name  ', description: '  Description  ', content: '' })).toEqual([
      '# Name\n\nDescription'
    ])
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

  it('keeps content before the first heading', () => {
    expect(
      chunk({
        name: 'Document',
        description: 'Description',
        content: 'Introduction.\n\n# Details\n\nBody.'
      }).slice(1)
    ).toEqual(['Introduction.', 'Details\n\nBody.'])
  })

  it('packs Markdown blocks up to the token limit without losing separators', () => {
    const first = 'A'.repeat(250)
    const second = 'B'.repeat(250)
    const third = 'C'.repeat(20)
    const chunks = chunk({
      name: 'Paragraphs',
      description: 'Description',
      content: `# Section\n\n${first}\n\n${second}\n\n${third}`
    }).slice(1)

    expect(chunks).toEqual([`Section\n\n${first}\n\n${second}`, `Section\n\n${third}`])
  })

  it('keeps a chunk whose size exactly matches the token limit', () => {
    const prefix = 'Section\n\n'
    const body = 'A'.repeat(MAX_CHUNK_TOKENS - countTokens(prefix))

    expect(
      chunk({
        name: '',
        description: '',
        content: `# Section\n\n${body}`
      })
    ).toEqual([`${prefix}${body}`])
  })

  it('packs complete Markdown blocks before splitting an oversized block', () => {
    const quote = `> ${'Q'.repeat(200)}`
    const code = `\`\`\`text\n${'C'.repeat(400)}\n\`\`\``
    const chunks = chunk({
      name: '',
      description: '',
      content: `# Section\n\n${quote}\n\n${code}`
    })

    expect(chunks[0]).toBe(`Section\n\n${quote}`)
    expect(chunks.every((part) => countTokens(part) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(
      chunks
        .slice(1)
        .map((part) => part.slice('Section\n\n'.length))
        .join('')
    ).toBe(code)
  })

  it('splits long content without headings', () => {
    const body = 'A'.repeat(1000)
    const chunks = chunk({ name: '', description: '', content: body })

    expect(chunks.every((part) => countTokens(part) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(chunks.join('')).toBe(body)
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

  it('splits Unicode text without breaking characters', () => {
    const body = '🙂'.repeat(600)
    const chunks = chunk({
      name: 'Unicode',
      description: 'Description',
      content: `# Emoji\n\n${body}`
    }).slice(1)
    const prefix = 'Emoji\n\n'

    expect(chunks.every((part) => countTokens(part) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(chunks.map((part) => part.slice(prefix.length)).join('')).toBe(body)
  })

  it('splits oversized metadata while retaining its name and description', () => {
    const description = 'D'.repeat(1000)
    const chunks = chunk({ name: 'Metadata', description, content: '' })
    const prefix = '# Metadata\n\n'

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((part) => countTokens(part) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(chunks.map((part) => part.slice(prefix.length)).join('')).toBe(description)
  })

  it('splits an oversized name without requiring a description', () => {
    const name = 'N'.repeat(1000)
    const chunks = chunk({ name, description: '', content: '' })

    expect(chunks.every((part) => countTokens(part) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(chunks.join('')).toBe(`# ${name}`)
  })

  it('treats an oversized heading as text and keeps all content', () => {
    const heading = 'H'.repeat(MAX_CHUNK_TOKENS)
    const chunks = chunk({
      name: 'Name',
      description: 'Description',
      content: `# ${heading}\n\nBody`
    }).slice(1)

    expect(chunks.every((part) => countTokens(part) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(chunks.join('')).toBe(`${heading}\n\nBody`)
  })

  it('stops repeating a heading when it leaves no room for content', () => {
    const heading = 'H'.repeat(MAX_CHUNK_TOKENS - 1)
    const chunks = chunk({
      name: '',
      description: '',
      content: `# ${heading}\n\nBody`
    })

    expect(chunks.every((part) => countTokens(part) <= MAX_CHUNK_TOKENS)).toBe(true)
    expect(chunks.join('')).toBe(`${heading}\n\nBody`)
  })
})
