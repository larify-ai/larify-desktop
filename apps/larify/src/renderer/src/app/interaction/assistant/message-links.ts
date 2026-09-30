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
        // `file` 只用于把「工作台视图的复用维度」从「按 root」细化到「按 root + 文件」：
        // 工作台（workbench.tsx）以 options 组合作为 scoped 复用键，不同文件 ⇒ 不同键
        // ⇒ 各自新开一个标签；同一文件 ⇒ 相同键 ⇒ 复用已有标签（不重复开）。
        // 该字段只是复用键，workspace 资源打开时只读 options.root，多余字段被忽略。
        options: { root, file: targetPath },
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
