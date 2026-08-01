import { readMarkdownSections } from './markdown-sections'

export interface MarkdownEmbeddingDocument {
  name: string
  description: string
  content: string
}

export type TokenCounter = (text: string) => number

export const MAX_CHUNK_TOKENS = 512

export function chunkMarkdown(
  document: MarkdownEmbeddingDocument,
  countTokens: TokenCounter
): string[] {
  const name = document.name.trim()
  const description = document.description.trim()
  if (!name || !description) throw new Error('Markdown document requires a name and description.')

  return [
    `# ${name}\n\n${description}`,
    ...splitByHeading(readMarkdownSections(document.content), countTokens)
  ]
}

type Section = ReturnType<typeof readMarkdownSections>[number]

function splitByHeading(sections: Section[], countTokens: TokenCounter, depth = 0): string[] {
  return groupByHeading(sections, depth).flatMap((group) => {
    const text = render(group)
    if (countTokens(text) <= MAX_CHUNK_TOKENS) return [text]

    const hasDeeperHeading = group.some((section) => section.headingPath.length > depth + 1)
    return hasDeeperHeading
      ? splitByHeading(group, countTokens, depth + 1)
      : splitLongSections(group, countTokens)
  })
}

function groupByHeading(sections: Section[], depth: number): Section[][] {
  const groups: Section[][] = []
  for (const section of sections) {
    const previous = groups.at(-1)
    if (previous?.at(-1)?.headingPath[depth] === section.headingPath[depth]) {
      previous.push(section)
    } else {
      groups.push([section])
    }
  }
  return groups
}

function render(sections: Section[]): string {
  const blocks: string[] = []
  let previousPath: string[] = []

  for (const section of sections) {
    let shared = 0
    while (
      shared < section.headingPath.length &&
      shared < previousPath.length &&
      section.headingPath[shared] === previousPath[shared]
    ) {
      shared++
    }
    blocks.push(...section.headingPath.slice(shared), section.content)
    previousPath = section.headingPath
  }

  return blocks.join('\n\n')
}

function splitLongSections(sections: Section[], countTokens: TokenCounter): string[] {
  return sections.flatMap((section) => splitSection(section, countTokens))
}

function splitSection(section: Section, countTokens: TokenCounter): string[] {
  const prefix = section.headingPath.join('\n\n')
  const chunks: string[] = []
  let content = ''

  for (const paragraph of section.content.split(/\n{2,}/)) {
    const combined = content ? `${content}\n\n${paragraph}` : paragraph
    if (countTokens(withPrefix(prefix, combined)) <= MAX_CHUNK_TOKENS) {
      content = combined
      continue
    }

    if (content) chunks.push(withPrefix(prefix, content))
    if (countTokens(withPrefix(prefix, paragraph)) > MAX_CHUNK_TOKENS) {
      chunks.push(...hardSplit(prefix, paragraph, countTokens))
      content = ''
    } else {
      content = paragraph
    }
  }

  if (content) chunks.push(withPrefix(prefix, content))
  return chunks
}

function hardSplit(prefix: string, text: string, countTokens: TokenCounter): string[] {
  const characters = Array.from(text)
  const chunks: string[] = []

  for (let start = 0; start < characters.length;) {
    let low = start + 1
    let high = characters.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      const candidate = withPrefix(prefix, characters.slice(start, middle).join(''))
      if (countTokens(candidate) <= MAX_CHUNK_TOKENS) low = middle
      else high = middle - 1
    }

    const chunk = withPrefix(prefix, characters.slice(start, low).join(''))
    if (countTokens(chunk) > MAX_CHUNK_TOKENS) {
      throw new Error('Markdown heading exceeds the embedding token limit.')
    }
    chunks.push(chunk)
    start = low
  }

  return chunks
}

function withPrefix(prefix: string, content: string): string {
  return prefix ? `${prefix}\n\n${content}` : content
}
