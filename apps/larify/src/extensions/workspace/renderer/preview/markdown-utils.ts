import parseFrontMatter from 'front-matter'

export function stripYamlFrontmatter(markdown: string): string {
  try {
    return parseFrontMatter(markdown).body
  } catch {
    return markdown
  }
}
