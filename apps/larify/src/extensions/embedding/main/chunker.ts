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

  return [
    ...splitMetadata(name, description, countTokens),
    ...splitByHeading(readMarkdownSections(document.content), countTokens)
  ]
}

function splitMetadata(name: string, description: string, countTokens: TokenCounter): string[] {
  const prefix = name ? `# ${name}` : ''
  const metadata = withPrefix(prefix, description)
  if (!metadata) return []
  if (fits(metadata, countTokens)) return [metadata]
  if (prefix && description && fits(prefix, countTokens)) {
    return hardSplit(prefix, description, countTokens)
  }
  return hardSplit('', metadata, countTokens)
}

type Section = ReturnType<typeof readMarkdownSections>[number]

function splitByHeading(sections: Section[], countTokens: TokenCounter, depth = 0): string[] {
  return groupByHeading(sections, depth).flatMap((group) => {
    const text = render(group)
    if (fits(text, countTokens)) return [text]

    const hasDeeperHeading = group.some((section) => section.headingPath.length > depth + 1)
    return hasDeeperHeading
      ? splitByHeading(group, countTokens, depth + 1)
      : group.flatMap((section) => splitSection(section, countTokens))
  })
}

function groupByHeading(sections: Section[], depth: number): Section[][] {
  const groups: Section[][] = []
  for (const section of sections) {
    const previous = groups.at(-1)
    if (previous && previous.at(-1)?.headingPath[depth] === section.headingPath[depth]) {
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
    blocks.push(...section.headingPath.slice(shared), ...section.blocks)
    previousPath = section.headingPath
  }

  return blocks.join('\n\n')
}

function splitSection(section: Section, countTokens: TokenCounter): string[] {
  const prefix = section.headingPath.join('\n\n')
  const chunks: string[] = []
  let content = ''

  for (const block of section.blocks) {
    const combined = withPrefix(content, block)
    if (fits(withPrefix(prefix, combined), countTokens)) {
      content = combined
      continue
    }

    if (content) chunks.push(withPrefix(prefix, content))
    if (!fits(withPrefix(prefix, block), countTokens)) {
      chunks.push(...hardSplit(prefix, block, countTokens))
      content = ''
    } else {
      content = block
    }
  }

  if (content) chunks.push(withPrefix(prefix, content))
  return chunks
}

function hardSplit(prefix: string, text: string, countTokens: TokenCounter): string[] {
  if (prefix && !fits(withPrefix(prefix, Array.from(text)[0] ?? ''), countTokens)) {
    return hardSplit('', withPrefix(prefix, text), countTokens)
  }
  const characters = Array.from(text)
  const chunks: string[] = []

  for (let start = 0; start < characters.length;) {
    let low = start + 1
    let high = characters.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      const candidate = withPrefix(prefix, characters.slice(start, middle).join(''))
      if (fits(candidate, countTokens)) low = middle
      else high = middle - 1
    }

    const chunk = withPrefix(prefix, characters.slice(start, low).join(''))
    chunks.push(chunk)
    start = low
  }

  return chunks
}

function fits(text: string, countTokens: TokenCounter): boolean {
  return countTokens(text) <= MAX_CHUNK_TOKENS
}

function withPrefix(prefix: string, content: string): string {
  if (!prefix) return content
  return content ? `${prefix}\n\n${content}` : prefix
}
