import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { fileTypeFromBuffer } from 'file-type'
import { editor, Uri } from 'monaco-editor/editor/editor.api'
import { useTheme } from 'next-themes'
import type { FileStatusResult } from 'simple-git'
import { gitClient } from '../git-client'
import { workspaceClient } from '../workspace-client'
import { workspaceMonacoLanguage, workspaceMonacoTheme } from '../preview/monaco'

const options = {
  automaticLayout: true,
  contextmenu: false,
  diffAlgorithm: 'advanced',
  enableSplitViewResizing: true,
  experimental: { useTrueInlineView: true },
  glyphMargin: false,
  lightbulb: { enabled: editor.ShowLightbulbIconMode.Off },
  lineNumbersMinChars: 4,
  minimap: { enabled: false },
  originalEditable: false,
  readOnly: true,
  renderIndicators: false,
  renderMarginRevertIcon: false,
  renderOverviewRuler: false,
  overviewRulerLanes: 0,
  scrollBeyondLastLine: false,
  scrollbar: { horizontalScrollbarSize: 8, verticalScrollbarSize: 8 },
  useInlineViewWhenSpaceIsLimited: false
} satisfies editor.IStandaloneDiffEditorConstructionOptions

interface MonacoDiffProps {
  mode: 'unified' | 'split'
  resourceId: number
  root: string
  status: FileStatusResult
}

export function MonacoDiff({ mode, resourceId, root, status }: MonacoDiffProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const requestKey = `${status.from ?? ''}:${status.path}:${status.index}${status.working_dir}`
  const [state, setState] = useState<{
    binary?: boolean
    error?: string
    key?: string
    modified?: string
    original?: string
  }>({})
  const editorRef = useRef<editor.IStandaloneDiffEditor>(null)
  const updateOriginalGutter = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor): void => {
      diffEditor
        .getOriginalEditor()
        .updateOptions(
          mode === 'unified'
            ? { lineDecorationsWidth: 0, lineNumbers: 'off' }
            : { lineDecorationsWidth: 10, lineNumbers: 'on' }
        )
      diffEditor.layout()
    },
    [mode]
  )

  useEffect(() => {
    if (editorRef.current) updateOriginalGutter(editorRef.current)
  }, [updateOriginalGutter])

  useEffect(() => {
    let active = true
    const originalFile = status.from ?? status.path
    const deleted = status.index === 'D' || status.working_dir === 'D'
    const modified = Promise.all([
      workspaceClient.readFile(resourceId, status.path),
      workspaceClient.inspectFile(resourceId, status.path)
    ])
      .then(([content, descriptor]) => ({ binary: descriptor.binary, content }))
      .catch((error) => {
        if (deleted) return { binary: false, content: '' }
        throw error
      })
    void Promise.all([gitClient.original(root, originalFile), modified]).then(
      async ([original, modified]) => {
        const binary =
          modified.binary || Boolean(original && (await fileTypeFromBuffer(original)))
        if (active) {
          setState({
            binary,
            key: requestKey,
            modified: modified.content,
            original: original ? new TextDecoder().decode(original) : ''
          })
        }
      },
      (error) => {
        if (active) {
          setState({
            error: error instanceof Error ? error.message : String(error),
            key: requestKey
          })
        }
      }
    )
    return () => {
      active = false
    }
  }, [requestKey, resourceId, root, status])

  if (state.key === requestKey && state.error) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        {state.error}
      </div>
    )
  }
  if (state.key === requestKey && state.binary) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        二进制文件无法预览
      </div>
    )
  }
  if (state.key !== requestKey || state.original === undefined || state.modified === undefined)
    return <div className="h-full" />

  return (
    <div className="workspace-file-preview h-full" data-diff-mode={mode}>
      <DiffEditor
        height="100%"
        loading={null}
        onMount={(diffEditor) => {
          editorRef.current = diffEditor
          updateOriginalGutter(diffEditor)
        }}
        modified={state.modified}
        modifiedLanguage={workspaceMonacoLanguage(status.path, state.modified)}
        modifiedModelPath={Uri.file(status.path).toString()}
        options={{ ...options, renderSideBySide: mode === 'split' }}
        original={state.original}
        originalLanguage={workspaceMonacoLanguage(status.from ?? status.path, state.original)}
        originalModelPath={Uri.file(status.from ?? status.path)
          .with({ scheme: 'git-original' })
          .toString()}
        theme={workspaceMonacoTheme(resolvedTheme === 'dark')}
      />
    </div>
  )
}
