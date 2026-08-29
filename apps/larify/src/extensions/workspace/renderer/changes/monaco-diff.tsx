import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MonacoEditor, { DiffEditor } from '@monaco-editor/react'
import { fileTypeFromBuffer } from 'file-type'
import { editor, Uri } from 'monaco-editor/editor/editor.api'
import { useTheme } from 'next-themes'
import type { FileStatusResult } from 'simple-git'
import { gitClient } from '../git-client'
import { workspaceClient } from '../workspace-client'
import { FilePreview } from '../preview/file-preview'
import {
  workspaceMonacoGutterOptions,
  workspaceMonacoLanguage,
  workspaceMonacoTheme
} from '../preview/monaco'

const editorOptions = {
  automaticLayout: false,
  contextmenu: false,
  ...workspaceMonacoGutterOptions,
  lightbulb: { enabled: editor.ShowLightbulbIconMode.Off },
  minimap: { enabled: false },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  readOnly: true,
  scrollBeyondLastLine: false,
  scrollbar: { horizontalScrollbarSize: 8, verticalScrollbarSize: 0 }
} satisfies editor.IStandaloneEditorConstructionOptions

const options = {
  ...editorOptions,
  diffAlgorithm: 'advanced',
  hideUnchangedRegions: { enabled: false },
  enableSplitViewResizing: true,
  originalEditable: false,
  renderIndicators: false,
  renderMarginRevertIcon: false,
  renderOverviewRuler: true,
  useInlineViewWhenSpaceIsLimited: false
} satisfies editor.IStandaloneDiffEditorConstructionOptions

const highlightAddedLines = (instance: editor.IStandaloneCodeEditor): void => {
  const model = instance.getModel()
  if (!model) return
  instance.createDecorationsCollection([
    {
      range: model.getFullModelRange(),
      options: { className: 'workspace-added-line', isWholeLine: true }
    }
  ])
}

interface MonacoDiffProps {
  active?: boolean
  animating?: boolean
  mode: 'unified' | 'split'
  resourceId: number
  root: string
  status: FileStatusResult
}

interface MonacoContentDiffProps {
  active?: boolean
  modelKey?: string
  mode: 'unified' | 'split'
  modified: string
  modifiedPath: string
  original: string
  originalPath: string
  scheme?: string
}

const useActiveEditorLayout = (
  active: boolean
): {
  containerRef: React.RefObject<HTMLDivElement | null>
  mountEditor(instance: { layout(dimension?: editor.IDimension): void }): void
} => {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<{ layout(dimension?: editor.IDimension): void } | null>(null)
  const frameRef = useRef<number | null>(null)
  const scheduleLayout = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const container = containerRef.current
      if (!container) return
      const width = container.clientWidth
      const height = container.clientHeight
      if (width <= 0 || height <= 0) return
      editorRef.current?.layout({ height, width })
    })
  }, [])
  const mountEditor = useCallback(
    (instance: { layout(dimension?: editor.IDimension): void }) => {
      editorRef.current = instance
      if (active) scheduleLayout()
    },
    [active, scheduleLayout]
  )
  useEffect(() => {
    if (!active) return
    scheduleLayout()
    const container = containerRef.current
    const observer =
      container && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleLayout)
        : undefined
    if (container) observer?.observe(container)
    return () => {
      observer?.disconnect()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [active, scheduleLayout])
  useEffect(() => () => void (editorRef.current = null), [])
  return { containerRef, mountEditor }
}

const modelPath = (path: string, scheme?: string, query?: string): string => {
  let uri = Uri.file(path)
  if (scheme) uri = uri.with({ scheme })
  if (query) uri = uri.with({ query })
  return uri.toString()
}

export function MonacoContentDiff({
  active = true,
  modelKey = '',
  mode,
  modified,
  modifiedPath,
  original,
  originalPath,
  scheme = 'git-original'
}: MonacoContentDiffProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const { containerRef, mountEditor } = useActiveEditorLayout(active)
  const deletedOnly = mode === 'unified' && modified.length === 0 && original.length > 0
  const addedOnly = mode === 'unified' && original.length === 0 && modified.length > 0
  const renderedModified = deletedOnly ? original : modified
  const renderedOriginal = deletedOnly ? '' : original
  const split = mode === 'split'
  const diffOptions = useMemo(
    () => ({ ...options, compactMode: !split, renderSideBySide: split }),
    [split]
  )
  const mountAddedEditor = useCallback(
    (instance: editor.IStandaloneCodeEditor) => {
      highlightAddedLines(instance)
      mountEditor(instance)
    },
    [mountEditor]
  )
  const modifiedModelPath = modelPath(
    modifiedPath,
    scheme === 'git-original' ? undefined : `${scheme}-modified`,
    modelKey
  )
  const originalModelPath = modelPath(originalPath, scheme, modelKey)

  if (addedOnly) {
    return (
      <div
        className="workspace-added-only-editor workspace-file-preview h-full"
        data-added-only="true"
        data-diff-mode={mode}
        data-modified-empty="false"
        data-original-empty="true"
        ref={containerRef}
      >
        <MonacoEditor
          height="100%"
          key={modifiedModelPath}
          language={workspaceMonacoLanguage(modifiedPath, modified)}
          loading={null}
          onMount={mountAddedEditor}
          options={editorOptions}
          path={modifiedModelPath}
          theme={workspaceMonacoTheme(resolvedTheme === 'dark')}
          value={modified}
        />
      </div>
    )
  }

  return (
    <div
      className="workspace-file-preview h-full"
      data-diff-mode={mode}
      data-added-only={addedOnly}
      data-deleted-only={deletedOnly}
      data-modified-empty={renderedModified.length === 0}
      data-original-empty={renderedOriginal.length === 0}
      ref={containerRef}
    >
      <DiffEditor
        height="100%"
        loading={null}
        modified={renderedModified}
        modifiedLanguage={workspaceMonacoLanguage(
          deletedOnly ? originalPath : modifiedPath,
          renderedModified
        )}
        modifiedModelPath={modifiedModelPath}
        onMount={(instance) => {
          mountEditor(instance)
          let jumped = false
          const jump = (): void => {
            if (jumped) return
            try {
              const changes =
                typeof instance.getLineChanges === 'function'
                  ? instance.getLineChanges()
                  : undefined
              const first = changes?.[0]
              if (!first) return
              jumped = true
              const modifiedStart = first.modifiedStartLineNumber
              const originalStart = first.originalStartLineNumber
              if (modifiedStart > 0) {
                instance.getModifiedEditor().revealLineInCenter(modifiedStart)
              }
              if (originalStart > 0) {
                const count = instance.getOriginalEditor().getModel()?.getLineCount() ?? 0
                if (count > 0) {
                  instance.getOriginalEditor().revealLineInCenter(originalStart)
                }
              }
            } catch {
              // Monaco methods can throw before the editor is fully initialised.
            }
          }
          const diffUpdateDisposable = instance.onDidUpdateDiff?.(() => jump())
          queueMicrotask(() => {
            jump()
            if (!jumped) setTimeout(jump, 0)
          })
          instance.onDidDispose?.(() => {
            diffUpdateDisposable?.dispose?.()
          })
        }}
        options={diffOptions}
        original={renderedOriginal}
        originalLanguage={workspaceMonacoLanguage(originalPath, renderedOriginal)}
        originalModelPath={originalModelPath}
        theme={workspaceMonacoTheme(resolvedTheme === 'dark')}
      />
    </div>
  )
}

export function MonacoDiff({
  active = true,
  animating = false,
  mode,
  resourceId,
  root,
  status
}: MonacoDiffProps): React.JSX.Element {
  const requestKey = `${resourceId}:${root}:${status.from ?? ''}:${status.path}:${status.index}${status.working_dir}`
  const loadedRef = useRef<{ requestKey: string; status: FileStatusResult } | null>(null)
  const [state, setState] = useState<{
    binary?: boolean
    error?: string
    exists?: boolean
    key?: string
    modified?: string
    original?: string
  }>({})
  useEffect(() => {
    if (
      !active ||
      (loadedRef.current?.requestKey === requestKey && loadedRef.current.status === status)
    )
      return
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
          loadedRef.current = { requestKey, status }
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
  }, [active, requestKey, resourceId, root, status])

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
      active={active}
      modelKey={String(resourceId)}
      mode={mode}
      modified={state.modified}
      modifiedPath={status.path}
      original={state.original}
      originalPath={status.from ?? status.path}
    />
  )
}
