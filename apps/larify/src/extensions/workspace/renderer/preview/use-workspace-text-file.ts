import { useEffect, useRef, useState } from 'react'
import { workspaceClient } from '../workspace-client'
import { previewErrorMessage } from './preview-error'

interface WorkspaceTextFileState {
  content?: string
  error?: string
  key: string
  /** 已加载文件内容缓存（不可变更新）：切换/回切文件时渲染期立即取用，不空白帧。 */
  cache: Map<string, string>
}

export function useWorkspaceTextFile(
  resourceId: number,
  path: string,
  active = true
): {
  content?: string
  error?: string
} {
  const key = `${resourceId}:${path}`
  const [state, setState] = useState<WorkspaceTextFileState>({ key, cache: new Map() })
  // effect 专用标记（渲染期不读取）：已发起过加载的 key（避免回切重读）与文件变更（onDidChange）。
  const loadedKeys = useRef(new Set<string>())
  const dirtyKey = useRef<string | null>(null)

  useEffect(() => {
    let subscribed = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const load = (): void => {
      const current = ++request
      void workspaceClient.readFile(resourceId, path).then(
        (content) => {
          if (!subscribed || current !== request) return
          dirtyKey.current = null
          setState((prev) => ({
            content,
            key,
            cache: new Map(prev.cache).set(key, content)
          }))
        },
        (reason: unknown) => {
          if (!subscribed || current !== request) return
          // 失败不视为「已加载」：切回该文件时允许重新读取（原 cache 语义）。
          loadedKeys.current.delete(key)
          setState((prev) => ({ error: previewErrorMessage(reason), key, cache: prev.cache }))
        }
      )
    }
    if (active && (!loadedKeys.current.has(key) || dirtyKey.current === key)) {
      loadedKeys.current.add(key)
      load()
    }
    const unsubscribe = workspaceClient.onDidChange(resourceId, (_directory, changedPath) => {
      if (changedPath !== path) return
      dirtyKey.current = key
      if (!active) return
      request += 1
      clearTimeout(timer)
      timer = setTimeout(load, 100)
    })
    return () => {
      subscribed = false
      clearTimeout(timer)
      unsubscribe()
    }
  }, [active, key, path, resourceId])

  // 切换文件后、新内容到达前：优先展示该文件的缓存内容（避免空白帧闪烁）；
  // 未缓存文件短暂展示上一文件内容作为占位；从未加载过则空占位，由调用方决定。
  if (state.key === key) return state
  const cached = state.cache.get(key)
  if (cached !== undefined) return { content: cached }
  return state.content !== undefined ? { content: state.content } : {}
}
