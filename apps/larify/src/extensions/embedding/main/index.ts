import type { Extension } from 'kernel'
import { EmbeddingWorker } from './worker-client'

let worker: EmbeddingWorker | undefined

export function getEmbeddingWorker(): EmbeddingWorker {
  return (worker ??= new EmbeddingWorker())
}

const extension: Extension = {
  activate(_app, context) {
    context.subscriptions.push({
      dispose() {
        const current = worker
        worker = undefined
        void current?.dispose()
      }
    })
  }
}

export default extension
