import type { Plugin } from '../../../main/core/plugin/protocol'
import { embeddingWorkerToken } from '../../embedding/main/service'
import { registerFileDiagnosticsProvider } from '../../fs/main/diagnostics'
import { createContextDiagnosticsProvider } from './diagnostics'
import { memoryRootPath } from './indexer'
import { contextWorkerToken } from './service'

const plugin: Plugin = {
  manifest: { id: 'context' },
  async activate(context) {
    const { ContextWorker } = await import('./worker-client')
    const worker = new ContextWorker(() => context.registry.get(embeddingWorkerToken))
    const root = memoryRootPath()
    context.registry.register(contextWorkerToken, worker)
    context.subscriptions.push({
      dispose: () => context.registry.dispose(contextWorkerToken)
    })
    const disposeDiagnostics = registerFileDiagnosticsProvider(
      createContextDiagnosticsProvider(root, (file, name) => worker.duplicateName(file, name))
    )
    context.subscriptions.push({ dispose: disposeDiagnostics })
  }
}

export default plugin
