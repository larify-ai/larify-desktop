import { useEffect, useRef, useState } from 'react'
import { renderEditorPart } from '@codingame/monaco-vscode-views-service-override'
import { monacoReady, observeWorkspaceEditor, setWorkspaceTheme } from './monaco'
import { WorkspaceIcon } from './workspace-icon'

interface WorkspaceEditorProps {
  theme: 'dark' | 'light'
}

export function WorkspaceEditor({ theme }: WorkspaceEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hasEditor, setHasEditor] = useState(false)

  useEffect(() => {
    let disposed = false
    let disposePart: (() => void) | undefined
    void monacoReady.then(() => {
      const container = containerRef.current
      if (disposed || !container) return
      container.replaceChildren()
      const part = renderEditorPart(container)
      disposePart = () => part.dispose()
    })
    return () => {
      disposed = true
      disposePart?.()
    }
  }, [])

  useEffect(() => {
    void setWorkspaceTheme(theme)
  }, [theme])

  useEffect(() => {
    let disposed = false
    let dispose: (() => void) | undefined
    void observeWorkspaceEditor(setHasEditor).then((listener) => {
      if (disposed) {
        listener()
        return
      }
      dispose = listener
    })
    return () => {
      disposed = true
      dispose?.()
    }
  }, [])

  return (
    <div className="workspace-editor relative h-full min-h-0 w-full">
      <div ref={containerRef} className="h-full min-h-0 w-full" />
      {!hasEditor ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background text-muted-foreground">
          <WorkspaceIcon className="size-16 opacity-30" />
          <p className="mt-2 text-lg font-medium text-foreground">开始编辑</p>
        </div>
      ) : null}
    </div>
  )
}
