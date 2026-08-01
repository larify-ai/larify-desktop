import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'

interface MarkdownSection {
  headingPath: string[]
  blocks: string[]
}

export function readMarkdownSections(markdown: string): MarkdownSection[] {
  const headings: string[] = []
  const sections: MarkdownSection[] = []
  let currentSection: MarkdownSection | undefined

  for (const node of fromMarkdown(markdown).children) {
    if (node.type === 'heading') {
      headings.length = node.depth - 1
      headings[node.depth - 1] = toString(node).trim()
      currentSection = undefined
      continue
    }

    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue

    const block = markdown.slice(start, end)
    if (!block.trim()) continue

    if (currentSection) {
      currentSection.blocks.push(block)
      continue
    }

    currentSection = {
      headingPath: headings.filter(Boolean),
      blocks: [block]
    }
    sections.push(currentSection)
  }
  return sections
}
