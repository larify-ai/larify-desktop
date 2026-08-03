export function isText(contentType: string | null): boolean {
  const type = contentType?.split(';', 1)[0].trim().toLowerCase()
  return Boolean(
    type?.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type?.endsWith('+json') ||
    type?.endsWith('+xml')
  )
}
