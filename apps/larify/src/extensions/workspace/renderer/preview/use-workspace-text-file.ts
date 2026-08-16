import { useEffect, useState } from 'react'
import { workspaceClient } from '../workspace-client'

export function useWorkspaceTextFile(
  resourceId: number,
  path: string
): {
  content?: string
  error?: string
} {
  const key = `${resourceId}:${path}`
  const [state, setState] = useState<{ content?: string; error?: string; key: string }>({ key })

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const load = (): void => {
      const current = ++request
      void workspaceClient.readFile(resourceId, path).then(
        (content) => active && current === request && setState({ content, key }),
        (reason: unknown) =>
          active &&
          current === request &&
          setState({ error: reason instanceof Error ? reason.message : String(reason), key })
      )
    }
    load()
    const unsubscribe = workspaceClient.onDidChange(resourceId, (_directory, changedPath) => {
      if (changedPath !== path) return
      request += 1
      clearTimeout(timer)
      timer = setTimeout(load, 100)
    })
    return () => {
      active = false
      clearTimeout(timer)
      unsubscribe()
    }
  }, [key, path, resourceId])

  return state.key === key ? state : {}
}
