import Editor from '@monaco-editor/react'
import { Uri, type editor } from 'monaco-editor/editor/editor.api'
import { useTheme } from 'next-themes'
import type { PreviewRendererProps } from '@renderer/app/registry/file-previews'
import { useWorkspaceTextFile } from './use-workspace-text-file'
import {
  workspaceMonacoGutterOptions,
  workspaceMonacoLanguage,
  workspaceMonacoTheme
} from './monaco'

const editorOptions = {
  automaticLayout: true,
  contextmenu: false,
  domReadOnly: true,
  ...workspaceMonacoGutterOptions,
  largeFileOptimizations: true,
  minimap: { enabled: false },
  occurrencesHighlight: 'off',
  overviewRulerLanes: 0,
  readOnly: true,
  renderLineHighlight: 'none',
  scrollbar: { horizontalScrollbarSize: 8, verticalScrollbarSize: 8 },
  scrollBeyondLastLine: false,
  selectionHighlight: false
} satisfies editor.IStandaloneEditorConstructionOptions

export function MonacoPreview({ file, resourceId }: PreviewRendererProps): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const { content, error } = useWorkspaceTextFile(resourceId, file.path)
  if (error) return <PreviewError message={error} />
  if (content === undefined) return <div className="h-full" />

  return (
    <div className="workspace-file-preview h-full">
      <Editor
        height="100%"
        loading={null}
        language={workspaceMonacoLanguage(file.path, content)}
        path={Uri.file(file.path).toString()}
        value={content}
        options={editorOptions}
        theme={workspaceMonacoTheme(resolvedTheme === 'dark')}
      />
    </div>
  )
}

function PreviewError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{message}</div>
  )
}
