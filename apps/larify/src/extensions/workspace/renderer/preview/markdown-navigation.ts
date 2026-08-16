import type { MouseEvent } from 'react'
import posixPath from 'path-unified/posix'
import win32Path from 'path-unified/win32'

export const workspaceMarkdownOpenFileEvent = 'larify:workspace-markdown-open-file'
export const workspaceMarkdownOpenExternalEvent = 'larify:workspace-markdown-open-external'

export function handleMarkdownLinkClick(
  event: MouseEvent<HTMLElement>,
  currentFile: string,
  resourceId: number
): void {
  if (!(event.target instanceof Element)) return
  const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
  const href = anchor?.getAttribute('href')
  if (!anchor || !href) return
  event.preventDefault()

  if (href.startsWith('#')) {
    scrollToHash(
      anchor.closest<HTMLElement>('.workspace-markdown-preview'),
      decodeUrlComponent(href.slice(1))
    )
    return
  }
  const externalUrl = href.startsWith('//')
    ? `https:${href}`
    : /^https?:/i.test(href)
      ? href
      : undefined
  if (externalUrl) {
    window.dispatchEvent(
      new CustomEvent(workspaceMarkdownOpenExternalEvent, {
        detail: { resourceId, url: externalUrl }
      })
    )
    return
  }
  if (/^[a-z][\w+.-]*:/i.test(href) && !win32Path.isAbsolute(href)) return

  const [pathAndQuery, hash] = href.split('#', 2)
  const [relativePath] = pathAndQuery.split('?', 1)
  window.dispatchEvent(
    new CustomEvent(workspaceMarkdownOpenFileEvent, {
      detail: {
        hash: hash ? decodeUrlComponent(hash) : undefined,
        path: relativePath
          ? resolveWorkspacePath(currentFile, decodeUrlComponent(relativePath))
          : currentFile,
        resourceId
      }
    })
  )
}

export function scrollToHash(root: HTMLElement | null, id: string): void {
  const target = [...(root?.querySelectorAll<HTMLElement>('[id]') ?? [])].find(
    (element) => element.id === id
  )
  target?.scrollIntoView()
}

export function resolveWorkspacePath(currentFile: string, target: string): string {
  if (win32Path.isAbsolute(target) || posixPath.isAbsolute(target)) return target
  const path = /^(?:[a-z]:[\\/]|\\\\)/i.test(currentFile) ? win32Path : posixPath
  return path.resolve(path.dirname(currentFile), target)
}

export function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
