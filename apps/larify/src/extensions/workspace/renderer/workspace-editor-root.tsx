import { useCallback, useEffect, useRef, useState } from 'react'
import {
  observeActiveWorkspaceFile,
  openWorkspaceDiff,
  openWorkspaceHighlightedDiff,
  openWorkspaceFile,
  prepareWorkspaceRoot,
  setWorkspaceTheme
} from './workspace-editor-service'
import { WorkspaceEditor } from './workspace-editor'
import { updateGitDecorations } from './git-decorations-provider'
import { enableDirtyDiff } from './dirty-diff'
import { monacoReady } from './monaco'
import { workspaceClient } from './workspace-client'

type Command =
  | { type: 'open'; root: string; file: string }
  | { type: 'open-diff'; root: string; file: string }
  | { type: 'open-highlighted-diff'; root: string; file: string; patch: string }
  | { type: 'prepare'; root: string }
  | { type: 'theme'; theme: 'dark' | 'light' }

export function WorkspaceEditorRoot(): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const runRef = useRef<((command: Command) => Promise<void>) | null>(null)
  const onReady = useCallback(() => {
    void (async () => {
      const commands = (await window.bridge.invoke('workspace-editor:ready')) as Command[]
      for (const command of commands) await runRef.current?.(command)
      await window.bridge.invoke('workspace-editor:present')
    })().catch((error) => console.error('[workspace-editor]', error))
  }, [])

  useEffect(() => {
    let disposed = false
    let disposeActive: (() => void) | undefined
    let disposeDirtyDiff: (() => void) | undefined
    const report = (operation: Promise<unknown>): void => {
      void operation.catch((error) => console.error('[workspace-editor]', error))
    }
    const run = async (command: Command): Promise<void> => {
      if (command.type === 'theme') {
        document.documentElement.classList.toggle('dark', command.theme === 'dark')
        document.documentElement.style.colorScheme = command.theme
        await setWorkspaceTheme(command.theme)
        return
      }
      setRoot(command.root)
      if (command.type === 'prepare') await prepareWorkspaceRoot(command.root)
      else if (command.type === 'open-diff') await openWorkspaceDiff(command.root, command.file)
      else if (command.type === 'open-highlighted-diff')
        await openWorkspaceHighlightedDiff(command.root, command.file, command.patch)
      else await openWorkspaceFile(command.root, command.file)
    }
    const unsubscribe = window.bridge.on('workspace-editor:command', (value) =>
      report(run(value as Command))
    )
    runRef.current = run
    report(
      observeActiveWorkspaceFile((file) => {
        setActiveFile(file)
        report(window.bridge.invoke('workspace-editor:active', file))
      }).then((dispose) => {
        if (disposed) dispose()
        else disposeActive = dispose
      })
    )
    report(
      monacoReady
        .then(() => enableDirtyDiff())
        .then((dispose) => {
          if (disposed) dispose()
          else disposeDirtyDiff = dispose
        })
    )
    return () => {
      disposed = true
      runRef.current = null
      unsubscribe()
      disposeActive?.()
      disposeDirtyDiff?.()
    }
  }, [])

  useEffect(() => {
    if (!root) return
    let disposed = false
    let running = false
    let queued = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = (): void => {
      if (running) {
        queued = true
        return
      }
      running = true
      void workspaceClient
        .gitStatuses()
        .then((result) => updateGitDecorations(result.available ? result.statuses : []))
        .catch((error) => console.error('[workspace-editor:git-status]', error))
        .finally(() => {
          running = false
          if (!disposed && queued) {
            queued = false
            schedule()
          }
        })
    }
    const schedule = (): void => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 400)
    }

    refresh()
    const unsubscribe = workspaceClient.onDidChange(schedule)
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
    }
  }, [root])

  return (
    <WorkspaceEditor
      activeFile={activeFile}
      onReady={onReady}
      root={root}
      onReveal={(path) =>
        void window.bridge
          .invoke('workspace-editor:reveal', path)
          .catch((error) => console.error('[workspace-editor:reveal]', error))
      }
    />
  )
}
