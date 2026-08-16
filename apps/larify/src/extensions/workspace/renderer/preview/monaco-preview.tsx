import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Uri, type editor } from 'monaco-editor/editor/editor.api'
import { useTheme } from 'next-themes'
import { workspaceClient } from '../workspace-client'
import type { PreviewRendererProps } from '@renderer/app/registry/file-previews'
import './monaco'

const editorOptions = {
  automaticLayout: true,
  contextmenu: false,
  domReadOnly: true,
  folding: true,
  largeFileOptimizations: true,
  lineNumbers: 'on',
  lineNumbersMinChars: 4,
  minimap: { enabled: false },
  occurrencesHighlight: 'off',
  readOnly: true,
  renderLineHighlight: 'none',
  scrollbar: { horizontalScrollbarSize: 8, verticalScrollbarSize: 8 },
  scrollBeyondLastLine: false,
  selectionHighlight: false
} satisfies editor.IStandaloneEditorConstructionOptions

export function MonacoPreview({ file, resourceId }: PreviewRendererProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const requestKey = `${resourceId}:${file.path}`
  const [state, setState] = useState<{ content?: string; error?: string; key: string }>({
    key: requestKey
  })

  useEffect(() => {
    let active = true
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const load = (): void => {
      const currentRequest = ++request
      void workspaceClient.readFile(resourceId, file.path).then(
        (content) => active && currentRequest === request && setState({ content, key: requestKey }),
        (reason: unknown) => {
          if (active && currentRequest === request) {
            setState({
              error: reason instanceof Error ? reason.message : String(reason),
              key: requestKey
            })
          }
        }
      )
    }

    load()
    const unsubscribe = workspaceClient.onDidChange(resourceId, (_directory, changedPath) => {
      if (changedPath !== file.path) return
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(load, 100)
    })

    return () => {
      active = false
      clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [file.path, requestKey, resourceId])

  const { content, error } =
    state.key === requestKey ? state : { content: undefined, error: undefined }
  if (error) return <PreviewError message={error} />
  if (content === undefined) return <div className="h-full" />

  return (
    <div className="workspace-file-preview h-full">
      <Editor
        height="100%"
        loading={null}
        path={Uri.file(file.path).toString()}
        value={content}
        options={editorOptions}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
      />
    </div>
  )
}

function PreviewError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{message}</div>
  )
}
