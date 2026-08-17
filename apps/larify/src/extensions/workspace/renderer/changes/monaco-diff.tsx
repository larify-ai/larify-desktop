import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { fileTypeFromBuffer } from 'file-type'
import { editor, Uri } from 'monaco-editor/editor/editor.api'
import { useTheme } from 'next-themes'
import type { FileStatusResult } from 'simple-git'
import { gitClient } from '../git-client'
import { workspaceClient } from '../workspace-client'
import { FilePreview } from '../preview/file-preview'
import { workspaceMonacoLanguage, workspaceMonacoTheme } from '../preview/monaco'

const options = {
  automaticLayout: true,
  compactMode: true,
  contextmenu: false,
  diffAlgorithm: 'advanced',
  enableSplitViewResizing: true,
  experimental: { useTrueInlineView: true },
  glyphMargin: false,
  lightbulb: { enabled: editor.ShowLightbulbIconMode.Off },
  lineDecorationsWidth: 8,
  lineNumbers: 'on',
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
  active?: boolean
  animating?: boolean
  mode: 'unified' | 'split'
  resourceId: number
  root: string
  status: FileStatusResult
}

interface MonacoContentDiffProps {
  modelKey?: string
  mode: 'unified' | 'split'
  modified: string
  modifiedPath: string
  original: string
  originalPath: string
  scheme?: string
}

const modelPath = (path: string, scheme?: string, query?: string): string => {
  let uri = Uri.file(path)
  if (scheme) uri = uri.with({ scheme })
  if (query) uri = uri.with({ query })
  return uri.toString()
}

export function MonacoContentDiff({
  modelKey = '',
  mode,
  modified,
  modifiedPath,
  original,
  originalPath,
  scheme = 'git-original'
}: MonacoContentDiffProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const deletedOnly = mode === 'unified' && modified.length === 0 && original.length > 0
  const renderedModified = deletedOnly ? original : modified
  const renderedOriginal = deletedOnly ? '' : original
  const split = mode === 'split'

  return (
    <div
      className="workspace-file-preview h-full"
      data-diff-mode={mode}
      data-deleted-only={deletedOnly}
      data-modified-empty={renderedModified.length === 0}
      data-original-empty={renderedOriginal.length === 0}
    >
      <DiffEditor
        height="100%"
        loading={null}
        modified={renderedModified}
        modifiedLanguage={workspaceMonacoLanguage(
          deletedOnly ? originalPath : modifiedPath,
          renderedModified
        )}
        modifiedModelPath={modelPath(
          modifiedPath,
          scheme === 'git-original' ? undefined : `${scheme}-modified`,
          modelKey
        )}
        options={{
          ...options,
          compactMode: !split,
          lineNumbersMinChars: split ? 2 : 4,
          renderSideBySide: split
        }}
        original={renderedOriginal}
        originalLanguage={workspaceMonacoLanguage(originalPath, renderedOriginal)}
        originalModelPath={modelPath(originalPath, scheme, modelKey)}
        theme={workspaceMonacoTheme(resolvedTheme === 'dark')}
      />
    </div>
  )
}

export function MonacoDiff({
  active = false,
  animating = false,
  mode,
  resourceId,
  root,
  status
}: MonacoDiffProps): React.JSX.Element {
  const requestKey = `${resourceId}:${root}:${status.from ?? ''}:${status.path}:${status.index}${status.working_dir}`
  const [state, setState] = useState<{
    binary?: boolean
    error?: string
    exists?: boolean
    key?: string
    modified?: string
    original?: string
  }>({})
  useEffect(() => {
    let alive = true
    const originalFile = status.from ?? status.path
    const missing =
      status.working_dir === 'D' || (status.index === 'D' && status.working_dir === ' ')
    const workingTree = missing
      ? Promise.resolve({ binary: false, content: '', exists: false })
      : Promise.all([
          workspaceClient.readFile(resourceId, status.path),
          workspaceClient.inspectFile(resourceId, status.path)
        ]).then(([content, descriptor]) => ({
          binary: descriptor.binary,
          content,
          exists: true
        }))
    void Promise.all([gitClient.original(root, originalFile), workingTree])
      .then(async ([original, current]) => {
        const binary = current.binary || Boolean(original && (await fileTypeFromBuffer(original)))
        if (alive) {
          setState({
            binary,
            exists: current.exists,
            key: requestKey,
            modified: current.content,
            original: original ? new TextDecoder().decode(original) : ''
          })
        }
      })
      .catch((error) => {
        if (alive) {
          setState({
            error: error instanceof Error ? error.message : String(error),
            key: requestKey
          })
        }
      })
    return () => {
      alive = false
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
    if (!state.exists)
      return (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">
          文件已删除
        </div>
      )
    return (
      <FilePreview
        active={active}
        animating={animating}
        path={status.path}
        resourceId={resourceId}
      />
    )
  }
  if (state.key !== requestKey || state.original === undefined || state.modified === undefined)
    return <div className="h-full" />

  return (
    <MonacoContentDiff
      mode={mode}
      modified={state.modified}
      modifiedPath={status.path}
      original={state.original}
      originalPath={status.from ?? status.path}
    />
  )
}
