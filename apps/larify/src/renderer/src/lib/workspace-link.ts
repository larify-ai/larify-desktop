import posixPath from 'path-unified/posix'
import win32Path from 'path-unified/win32'

export type WorkspaceLink =
  | { kind: 'anchor'; hash: string }
  | { kind: 'url'; url: string }
  | { kind: 'file'; target: string; hash?: string }

type PathApi = Pick<typeof posixPath, 'dirname' | 'isAbsolute' | 'normalize' | 'resolve'>
type FileLink = Extract<WorkspaceLink, { kind: 'file' }>

const schemePattern = /^([a-z][\w+.-]*):/i
const windowsRootPattern = /^(?:[a-z]:[\\/]|\\\\)/i
const encodedWindowsRootPattern = /^(?:[a-z]:(?:%2f|%5c)|(?:%5c){2})/i

function schemeOf(value: string): string | undefined {
  return schemePattern.exec(value)?.[1].toLowerCase()
}

export function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseFileLink(href: string, fileUrl = false): FileLink {
  const hashIndex = href.indexOf('#')
  const pathAndQuery = hashIndex < 0 ? href : href.slice(0, hashIndex)
  const rawHash = hashIndex < 0 ? '' : href.slice(hashIndex + 1)
  const queryIndex = pathAndQuery.indexOf('?')
  const rawTarget = queryIndex < 0 ? pathAndQuery : pathAndQuery.slice(0, queryIndex)
  return {
    kind: 'file',
    target: fileUrl ? rawTarget : decodeUrlComponent(rawTarget),
    ...(rawHash ? { hash: decodeUrlComponent(rawHash) } : {})
  }
}

export function parseWorkspaceLink(href: string): WorkspaceLink | null {
  if (encodedWindowsRootPattern.test(href)) href = href.replace(/%(?:2f|5c)/gi, '\\')
  if (href.startsWith('#')) {
    return { kind: 'anchor', hash: decodeUrlComponent(href.slice(1)) }
  }
  if (href.startsWith('//')) return { kind: 'url', url: `https:${href}` }

  const scheme = schemeOf(href)
  switch (scheme) {
    case 'http':
    case 'https':
      return { kind: 'url', url: href }
    case 'file':
      return URL.canParse(href) ? parseFileLink(href, true) : null
    case undefined:
      return parseFileLink(href)
    default:
      return win32Path.isAbsolute(href) ? parseFileLink(href) : null
  }
}

function pathFor(value: string): PathApi {
  return windowsRootPattern.test(value) ? win32Path : posixPath
}

function fileUrlToPath(target: string): string {
  const url = new URL(target)
  let path = decodeUrlComponent(url.pathname)
  if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1)
  return url.host ? `\\\\${url.host}${path.replaceAll('/', '\\')}` : path
}

export function resolveWorkspaceLink(base: string, href: string): { path: string; hash?: string } {
  const link = parseWorkspaceLink(href)
  if (link?.kind !== 'file') throw new Error(`Expected a file link: ${href}`)

  const target = schemeOf(link.target) === 'file' ? fileUrlToPath(link.target) : link.target
  const targetPath = pathFor(target)
  const path = targetPath.isAbsolute(target) ? targetPath : pathFor(base)
  return {
    path: path.isAbsolute(target) ? path.normalize(target) : path.resolve(base, target),
    ...(link.hash ? { hash: link.hash } : {})
  }
}

export function resolveWorkspacePath(currentFile: string, target: string): string {
  if (win32Path.isAbsolute(target) || posixPath.isAbsolute(target)) return target
  const path = pathFor(currentFile)
  return path.resolve(path.dirname(currentFile), target)
}
