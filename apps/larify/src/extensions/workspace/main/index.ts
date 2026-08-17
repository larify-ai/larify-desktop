import type { Plugin } from '../../../main/core/plugin/protocol'
import type { Disposable } from '@shared/infra/disposable'
import { resourceManagerToken, type ResourceManager } from '../../../main/core/resource'
import { larifyWorkspacePath } from '../../../main/utils/app-paths'
import { windowToken } from '../../../main/window/token'
import type { MainWindow } from '../../../main/window/types'
import { registerWorkspaceIpc } from './ipc'
import { WorkspaceManager } from './manager'
import { NativePreviewManager } from './native-preview-manager'

const plugin: Plugin = {
  manifest: {
    id: 'workspace'
  },
  activate(context) {
    const resources = context.registry.get<ResourceManager>(resourceManagerToken)
    if (!resources) throw new Error('ResourceManager is unavailable.')
    const mainWindow = context.registry.get<MainWindow>(windowToken)
    if (!mainWindow) throw new Error('MainWindow is unavailable.')
    const window = mainWindow.get()
    const manager = new WorkspaceManager()
    const previews = new NativePreviewManager(window)
    context.subscriptions.push(manager, previews)
    const clearPreviewsOnNavigation = (
      _event: Electron.Event,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean
    ): void => {
      if (isMainFrame && !isInPlace) previews.dispose()
    }
    const openWorkspace = (id: number, _sessionId: string, options: unknown): Disposable => {
      const root = (options as { root?: string } | undefined)?.root || larifyWorkspacePath()
      const workspace = manager.open(id, root)
      return {
        async dispose() {
          try {
            previews.close(id)
          } finally {
            await workspace.dispose()
          }
        }
      }
    }
    window.webContents.on('did-start-navigation', clearPreviewsOnNavigation)
    context.subscriptions.push({
      dispose() {
        window.webContents.off('did-start-navigation', clearPreviewsOnNavigation)
      }
    })
    context.subscriptions.push(resources.register('workspace', openWorkspace))
    context.subscriptions.push(resources.register('changes', openWorkspace))
    context.subscriptions.push({ dispose: registerWorkspaceIpc(manager, previews, window) })
  }
}

export default plugin
