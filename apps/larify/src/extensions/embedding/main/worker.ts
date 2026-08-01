import { parentPort } from 'node:worker_threads'
import { chunkMarkdown } from './chunker'
import { EmbeddingService } from './service'
import type { EmbeddingWorkerRequest, EmbeddingWorkerResponse } from './worker-protocol'

const embeddings = new EmbeddingService()
if (!parentPort) throw new Error('Embedding worker requires a parent port.')
const port = parentPort

port.on('message', async (request: EmbeddingWorkerRequest) => {
  try {
    const result = await handle(request)
    port.postMessage({ id: request.id, result } satisfies EmbeddingWorkerResponse)
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    } satisfies EmbeddingWorkerResponse)
  }
})

async function handle(request: EmbeddingWorkerRequest): Promise<number[] | number[][]> {
  switch (request.type) {
    case 'embed-query':
      return embeddings.embedQuery(request.query)
    case 'embed-markdown':
      return embeddings.embedDocuments(
        chunkMarkdown(request.document, await embeddings.tokenCounter())
      )
    default:
      throw new Error('Unknown embedding worker request.')
  }
}
