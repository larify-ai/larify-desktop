import type { Extension } from '@shared/extension'
import { registerWorkspaceIpc } from './ipc'
import { WorkspaceService } from './workspace-service'
import { WorkspaceEditorHost } from './workspace-editor-host'
import { gitService } from '../../../main/core/git'
import { GitService } from './git/git-service'

interface MainWindowService {
  get(): import('electron').BrowserWindow
}

const extension: Extension = {
  activate(_app, context) {
    const service = new WorkspaceService(new GitService(gitService))
    let editor: WorkspaceEditorHost | null = null
    const getEditor = (): WorkspaceEditorHost => {
      if (editor) return editor
      const mainWindow = _app.get<MainWindowService>('service', 'main-window')
      if (!mainWindow) throw new Error('main-window service is not registered')
      editor = new WorkspaceEditorHost(mainWindow.get())
      return editor
    }
    const unregisterIpc = registerWorkspaceIpc(service, getEditor)
    let preload: ReturnType<typeof setTimeout> | undefined
    const warmEditor = (): void => {
      preload = setTimeout(() => {
        try {
          getEditor()
        } catch (error) {
          console.error('[workspace:editor-preload]', error)
        }
      }, 0)
    }
    const mainWindow = _app.get<MainWindowService>('service', 'main-window')?.get()
    const mainContents = mainWindow?.webContents
    if (mainContents?.isLoadingMainFrame()) mainContents.once('did-finish-load', warmEditor)
    else warmEditor()
    context.subscriptions.push({
      dispose: async () => {
        mainContents?.removeListener('did-finish-load', warmEditor)
        if (preload) clearTimeout(preload)
        unregisterIpc()
        editor?.destroy()
        await service.dispose()
      }
    })
  }
}

export default extension
