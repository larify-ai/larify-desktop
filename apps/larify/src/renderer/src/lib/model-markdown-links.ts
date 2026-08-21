const windowsMarkdownLink = /(!?\[[^\]\r\n]*\]\(\s*)([a-z]:\\[^\s\r\n)]*)(\s*\))/gi
const angleBracketedWindowsMarkdownLink = /(!?\[[^\]\r\n]*\]\(\s*<)([a-z]:\\[^>\r\n]*)(>\s*\))/gi

function replaceWindowsSeparators(
  _match: string,
  prefix: string,
  destination: string,
  suffix: string
): string {
  return `${prefix}${destination.replaceAll('\\', '/')}${suffix}`
}

/**
 * Normalize Windows absolute paths in model-authored Markdown destinations before parsing.
 * Markdown treats the final `\.` in hidden-file paths as an escape and otherwise corrupts it.
 */
export function normalizeModelMarkdownLinks(markdown: string): string {
  return markdown
    .replace(angleBracketedWindowsMarkdownLink, replaceWindowsSeparators)
    .replace(windowsMarkdownLink, replaceWindowsSeparators)
}
