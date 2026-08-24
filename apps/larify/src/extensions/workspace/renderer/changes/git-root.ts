export function normalizeGitRoot(root: string): string {
  const normalized = root.replaceAll('\\', '/')
  const withoutTrailingSlash = normalized.replace(/\/+$/, '')
  let trimmed = withoutTrailingSlash || (normalized ? '/' : '')
  if (/^[a-z]:$/i.test(trimmed) && normalized.endsWith('/')) trimmed += '/'
  return /^(?:[a-z]:|\/\/)/i.test(trimmed) ? trimmed.toLowerCase() : trimmed
}
