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
    .invoke('browser:openUrl', sessionId, url)
    .then((browserResourceId) => {
      if (!isCurrent()) return
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

function openWorkspaceDirectory(targetPath: string, isCurrent: () => boolean): void {
  window.dispatchEvent(
    new CustomEvent('larify:workbench-open', {
      detail: {
        rendererId: 'workspace',
        options: { root: targetPath },
        onOpen: (resourceId: number) => {
          if (!isCurrent()) return
          requestWorkspaceNavigation({ kind: 'directory', path: targetPath, resourceId })
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
    // 默认空间（cwd 为空）时相对路径没有前端基准，由后端提供默认工作区根
    // （与应用侧 agent 相对路径解析基准一致），再交由渲染层继续解析。
    void (cwd
      ? Promise.resolve(cwd)
      : window.bridge.invoke('workspace:default-root')
    )
      .then((base: string) => resolveWorkspaceLink(base, link.target))
      .then((resolved) => {
        const { path, hash } = resolved
        return window.bridge
          .invoke('workspace:path-kind', path)
          .then((kind: string) => {
            if (!isCurrent()) return
            if (kind === 'directory') openWorkspaceDirectory(path, isCurrent)
            else openWorkspaceFile(cwd, path, isCurrent, hash)
          })
      })
      .catch((error) => {
        if (!isCurrent()) return
        console.error('[message-link:inspect-path]', error)
      })
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
