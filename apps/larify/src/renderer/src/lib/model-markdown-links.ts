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

export function normalizeModelMarkdownLinks(markdown: string): string {
  return markdown
    .replace(angleBracketedWindowsMarkdownLink, replaceWindowsSeparators)
    .replace(windowsMarkdownLink, replaceWindowsSeparators)
}
