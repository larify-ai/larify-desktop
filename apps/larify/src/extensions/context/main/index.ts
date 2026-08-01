import { join, resolve } from 'node:path'
import type { Disposable, Extension } from 'kernel'
import { createContextDiagnosticsProvider } from './diagnostics'
import { cleanContextRegistry, registerContext } from './workspace'
import { ContextWorker } from './worker-client'
import { registerFileDiagnosticsProvider } from '../../file/main/diagnostics'

const extension: Extension = {
  activate(app, context) {
    const worker = new ContextWorker()
    const workspaces = new Map<string, Disposable>()
    cleanContextRegistry()
    app.register('service', 'context', worker)

    app.on('workspace:open', (cwd) => {
      if (typeof cwd !== 'string') return
      const workspace = resolve(cwd)
      if (workspaces.has(workspace)) return

      registerContext(workspace)
      const root = join(workspace, '.larify')
      const disposeDiagnostics = registerFileDiagnosticsProvider(
        createContextDiagnosticsProvider(root, (file, name) =>
          worker.duplicateName(workspace, file, name)
        )
      )
      const disposable: Disposable = {
        async dispose() {
          disposeDiagnostics()
          await worker.close(workspace)
        }
      }
      workspaces.set(workspace, disposable)
      void worker.open(workspace).catch((error) => {
        console.error('[context:open]', error)
        if (workspaces.get(workspace) !== disposable) return
        disposeDiagnostics()
        workspaces.delete(workspace)
      })
    })

    context.subscriptions.push({
      async dispose() {
        await Promise.all([...workspaces.values()].map((workspace) => workspace.dispose()))
        workspaces.clear()
        await worker.dispose()
      }
    })
  }
}

export default extension
