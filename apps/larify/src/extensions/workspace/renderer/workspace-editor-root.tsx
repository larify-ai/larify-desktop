import { useEffect, useState } from 'react'
import {
  observeActiveWorkspaceFile,
  openWorkspaceFile,
  prepareWorkspaceRoot,
  setWorkspaceTheme
} from './workspace-editor-service'
import { WorkspaceEditor } from './workspace-editor'

type Command =
  | { type: 'open'; root: string; file: string }
  | { type: 'prepare'; root: string }
  | { type: 'theme'; theme: 'dark' | 'light' }

export function WorkspaceEditorRoot(): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let disposeActive: (() => void) | undefined
    const report = (operation: Promise<unknown>): void => {
      void operation.catch((error) => console.error('[workspace-editor]', error))
    }
    const run = (command: Command): void => {
      if (command.type === 'theme') {
        document.documentElement.classList.toggle('dark', command.theme === 'dark')
        document.documentElement.style.colorScheme = command.theme
        report(setWorkspaceTheme(command.theme))
        return
      }
      setRoot(command.root)
      if (command.type === 'prepare') report(prepareWorkspaceRoot(command.root))
      else report(openWorkspaceFile(command.root, command.file))
    }
    const unsubscribe = window.bridge.on('workspace-editor:command', (value) =>
      run(value as Command)
    )
    report(
      window.bridge
        .invoke('workspace-editor:ready')
        .then((commands) => (commands as Command[]).forEach(run))
    )
    report(
      observeActiveWorkspaceFile((file) => {
        setActiveFile(file)
        report(window.bridge.invoke('workspace-editor:active', file))
      }).then((dispose) => {
        if (disposed) dispose()
        else disposeActive = dispose
      })
    )
    return () => {
      disposed = true
      unsubscribe()
      disposeActive?.()
    }
  }, [])

  return (
    <WorkspaceEditor
      activeFile={activeFile}
      root={root}
      onReveal={(path) =>
        void window.bridge
          .invoke('workspace-editor:reveal', path)
          .catch((error) => console.error('[workspace-editor:reveal]', error))
      }
    />
  )
}
