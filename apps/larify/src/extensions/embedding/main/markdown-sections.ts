import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'

interface MarkdownSection {
  headingPath: string[]
  content: string
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

    const content = markdown.slice(start, end).trim()
    if (!content) continue

    if (currentSection) {
      currentSection.content += `\n\n${content}`
      continue
    }

    currentSection = {
      headingPath: headings.filter(Boolean),
      content
    }
    sections.push(currentSection)
  }
  return sections
}
