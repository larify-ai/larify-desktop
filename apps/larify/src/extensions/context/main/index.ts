import type { Plugin } from '../../../main/core/plugin/protocol'
import { gitService } from '../../../main/core/git'
import { embeddingWorkerToken } from '../../embedding/main/service'
import { registerFileDiagnosticsProvider } from '../../fs/main/diagnostics'
import { createContextDiagnosticsProvider } from './diagnostics'
import { memoryRootPath, tasksRootPath } from './indexer'
import { contextWorkerToken } from './service'
import { createTaskDiagnosticsProvider } from './task-diagnostics'

const plugin: Plugin = {
  manifest: { id: 'context' },
  async activate(context) {
    const root = memoryRootPath()
    const git = await gitService.open(root)
    if (!(await git.checkIsRepo())) await git.init()
    const { ContextWorker } = await import('./worker-client')
    const worker = new ContextWorker(() => context.registry.get(embeddingWorkerToken))
    context.registry.register(contextWorkerToken, worker)
    context.subscriptions.push({
      dispose: () => context.registry.dispose(contextWorkerToken)
    })
    const disposeDiagnostics = registerFileDiagnosticsProvider(
      createContextDiagnosticsProvider(root, (file, name) => worker.duplicateName(file, name))
    )
    context.subscriptions.push({ dispose: disposeDiagnostics })

    const disposeTaskDiagnostics = registerFileDiagnosticsProvider(
      createTaskDiagnosticsProvider(tasksRootPath())
    )
    context.subscriptions.push({ dispose: disposeTaskDiagnostics })
  }
}

export default plugin
