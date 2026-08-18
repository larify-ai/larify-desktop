import type { Plugin } from '../../../main/core/plugin/protocol'
import { embeddingWorkerToken } from './service'

const plugin: Plugin = {
  manifest: {
    id: 'embedding'
  },
  async activate(context) {
    const { EmbeddingWorker } = await import('./worker-client')
    const worker = new EmbeddingWorker()
    context.registry.register(embeddingWorkerToken, worker)
    context.subscriptions.push({
      async dispose() {
        await context.registry.dispose(embeddingWorkerToken)
      }
    })
  }
}

export default plugin
