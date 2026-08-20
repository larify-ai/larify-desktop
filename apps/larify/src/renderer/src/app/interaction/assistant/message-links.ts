import { createContext, useContext } from 'react'
import {
  requestWorkspaceNavigation,
  workspaceRootForFile
} from '../../../../../extensions/workspace/renderer/workspace-navigation'
import type { MessageLinkHandler } from '@renderer/components/ai-elements/message-link'
import { resolveWorkspaceLink } from '@renderer/lib/workspace-link'

export type DisposableMessageLinkHandler = MessageLinkHandler & { dispose(): void }

function openUrlInBrowser(sessionId: string, url: string, isCurrent: () => boolean): void {
  void window.bridge
    .invoke('resource:create', 'browser', sessionId, { url })
    .then((browserResourceId) => {
      if (!isCurrent()) {
        void window.bridge
          .invoke('resource:close', browserResourceId)
          .catch((error) => console.error('[message-link:close-browser]', error))
        return
      }
      window.dispatchEvent(
        new CustomEvent('larify:workbench-select-resource', {
          detail: { rendererId: 'browser', resourceId: browserResourceId, sessionId }
        })
      )
    })
    .catch((error) => console.error('[message-link:open-browser]', error))
}

function openWorkspaceFile(
  cwd: string,
  targetPath: string,
  isCurrent: () => boolean,
  hash?: string
): void {
  const root = workspaceRootForFile(cwd, targetPath)
  window.dispatchEvent(
    new CustomEvent('larify:workbench-open', {
      detail: {
        rendererId: 'workspace',
        options: { root },
        onOpen: (resourceId: number) => {
          if (!isCurrent()) return
          requestWorkspaceNavigation({ path: targetPath, hash, resourceId })
        }
      }
    })
  )
}

export function createMessageLinkHandler(
  cwd: string,
  sessionId: string
): DisposableMessageLinkHandler {
  let request = 0
  let active = true
  const handler: MessageLinkHandler = (link) => {
    if (!active) return
    const current = ++request
    const isCurrent = (): boolean => active && current === request
    if (link.kind === 'url') {
      openUrlInBrowser(sessionId, link.target, isCurrent)
      return
    }
    const { path, hash } = resolveWorkspaceLink(cwd, link.target)
    openWorkspaceFile(cwd, path, isCurrent, hash)
  }
  return Object.assign(handler, {
    dispose: () => {
      active = false
    }
  })
}

const MessageLinkContext = createContext<MessageLinkHandler | null>(null)

export const MessageLinkContextProvider = MessageLinkContext.Provider

/** 读取当前会话用于打开正文链接的处理器；未注入时返回 null（链接仅展示不可点击）。 */
export function useMessageLinkHandler(): MessageLinkHandler | null {
  return useContext(MessageLinkContext)
}
