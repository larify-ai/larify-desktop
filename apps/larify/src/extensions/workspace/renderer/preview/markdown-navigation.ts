import type { MouseEvent } from 'react'
import {
  decodeUrlComponent,
  parseWorkspaceLink,
  resolveWorkspacePath
} from '@renderer/lib/workspace-link'

export { decodeUrlComponent, resolveWorkspacePath }

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

  const link = parseWorkspaceLink(href)
  if (!link) return
  if (link.kind === 'anchor') {
    scrollToHash(anchor.closest<HTMLElement>('.workspace-markdown-preview'), link.hash)
    return
  }
  if (link.kind === 'url') {
    window.dispatchEvent(
      new CustomEvent(workspaceMarkdownOpenExternalEvent, {
        detail: { resourceId, url: link.url }
      })
    )
    return
  }
  window.dispatchEvent(
    new CustomEvent(workspaceMarkdownOpenFileEvent, {
      detail: {
        hash: link.hash,
        path: link.target ? resolveWorkspacePath(currentFile, link.target) : currentFile,
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
