import { useEffect, useRef, useState } from 'react'
import { workspaceClient } from '../workspace-client'
import { previewErrorMessage } from './preview-error'

export function useWorkspaceTextFile(
  resourceId: number,
  path: string,
  active = true
): {
  content?: string
  error?: string
} {
  const key = `${resourceId}:${path}`
  const [state, setState] = useState<{ content?: string; error?: string; key: string }>({ key })
  const loadedKey = useRef<string | null>(null)
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
          loadedKey.current = key
          dirtyKey.current = null
          setState({ content, key })
        },
        (reason: unknown) => {
          if (!subscribed || current !== request) return
          setState({ error: previewErrorMessage(reason), key })
        }
      )
    }
    if (active && (loadedKey.current !== key || dirtyKey.current === key)) load()
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

  return state.key === key ? state : {}
}
