import Editor from '@monaco-editor/react'
import { Uri, type editor } from 'monaco-editor/editor/editor.api'
import { useTheme } from 'next-themes'
import { memo, useCallback, useEffect, useRef, type RefObject } from 'react'
import type { PreviewRendererProps } from '@renderer/app/registry/file-previews'
import { useWorkspaceTextFile } from './use-workspace-text-file'
import {
  workspaceMonacoGutterOptions,
  workspaceMonacoLanguage,
  workspaceMonacoTheme
} from './monaco'

const editorOptions = {
  automaticLayout: false,
  contextmenu: false,
  domReadOnly: true,
  ...workspaceMonacoGutterOptions,
  largeFileOptimizations: true,
  minimap: { enabled: false },
  occurrencesHighlight: 'off',
  overviewRulerLanes: 0,
  readOnly: true,
  renderLineHighlight: 'none',
  scrollbar: { horizontalScrollbarSize: 8, verticalScrollbarSize: 0 },
  scrollBeyondLastLine: false,
  selectionHighlight: false
} satisfies editor.IStandaloneEditorConstructionOptions

export function MonacoPreview({
  active,
  file,
  resourceId
}: PreviewRendererProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const { content, error } = useWorkspaceTextFile(resourceId, file.path, active)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const layoutFrameRef = useRef<number | null>(null)
  const editorVisible = !error && content !== undefined
  const scheduleLayout = useCallback(() => {
    if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current)
    layoutFrameRef.current = requestAnimationFrame(() => {
      layoutFrameRef.current = null
      const editorInstance = editorRef.current
      const container = containerRef.current
      if (!editorInstance || !container) return
      const width = container.clientWidth
      const height = container.clientHeight
      if (width <= 0 || height <= 0) return
      const layout = editorInstance.getLayoutInfo()
      if (layout.width === width && layout.height === height) return
      editorInstance.layout({ height, width })
    })
  }, [])
  const mountEditor = useCallback(
    (instance: editor.IStandaloneCodeEditor) => {
      editorRef.current = instance
      scheduleLayout()
    },
    [scheduleLayout]
  )
  const unmountEditor = useCallback(() => {
    editorRef.current = null
  }, [])
  useEffect(() => {
    if (!active || !editorVisible) return
    scheduleLayout()
    const container = containerRef.current
    const observer =
      container && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleLayout)
        : undefined
    if (container) observer?.observe(container)
    return () => {
      observer?.disconnect()
      if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current)
      layoutFrameRef.current = null
    }
  }, [active, editorVisible, scheduleLayout])
  if (error) return <PreviewError message={error} />
  if (content === undefined) return <div className="h-full" />

  return (
    <StableMonacoEditor
      content={content}
      containerRef={containerRef}
      filePath={file.path}
      onMount={mountEditor}
      onUnmount={unmountEditor}
      theme={workspaceMonacoTheme(resolvedTheme === 'dark')}
    />
  )
}

const StableMonacoEditor = memo(function StableMonacoEditor({
  content,
  containerRef,
  filePath,
  onMount,
  onUnmount,
  theme
}: {
  content: string
  containerRef: RefObject<HTMLDivElement | null>
  filePath: string
  onMount(instance: editor.IStandaloneCodeEditor): void
  onUnmount(): void
  theme: string
}): React.JSX.Element {
  useEffect(() => onUnmount, [onUnmount])
  return (
    <div className="workspace-file-preview h-full" ref={containerRef}>
      <Editor
        height="100%"
        loading={null}
        language={workspaceMonacoLanguage(filePath, content)}
        path={Uri.file(filePath).toString()}
        value={content}
        onMount={onMount}
        options={editorOptions}
        theme={theme}
      />
    </div>
  )
})

function PreviewError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{message}</div>
  )
}
