import type { Extension } from 'kernel'
import { registerWorkspaceIpc } from './ipc'
import { WorkspaceService } from './workspace-service'

const extension: Extension = {
  activate(_app, context) {
    const service = new WorkspaceService()
    const unregisterIpc = registerWorkspaceIpc(service)
    context.subscriptions.push({
      dispose: async () => {
        unregisterIpc()
        await service.dispose()
      }
    })
  }
}

export default extension
