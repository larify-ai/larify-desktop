export function isTextMime(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime.endsWith('xml') ||
    mime === 'application/json' ||
    mime === 'application/octet-stream'
  )
}
