import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class WorkerMock extends EventEmitter {
  static instances: WorkerMock[] = []
  postMessage = vi.fn()
  terminate = vi.fn(async () => 0)

  constructor() {
    super()
    WorkerMock.instances.push(this)
  }
}

vi.mock('../../../../src/extensions/embedding/main/worker?nodeWorker', () => ({
  default: () => new WorkerMock()
}))

import { EmbeddingWorker } from '../../../../src/extensions/embedding/main/worker-client'

beforeEach(() => {
  WorkerMock.instances.length = 0
  vi.clearAllMocks()
})

describe('EmbeddingWorker', () => {
  it('reuses one worker for query and Markdown requests', async () => {
    const embeddings = new EmbeddingWorker()
    const query = embeddings.embedQuery('query')
    const worker = WorkerMock.instances[0]
    worker.emit('message', { id: 0, result: [1, 2] })
    await expect(query).resolves.toEqual([1, 2])

    const markdown = embeddings.embedMarkdown({
      name: 'Document',
      description: 'Description',
      content: 'Content'
    })
    worker.emit('message', { id: 1, result: [[3, 4]] })
    await expect(markdown).resolves.toEqual([[3, 4]])

    expect(WorkerMock.instances).toHaveLength(1)
    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      id: 0,
      type: 'embed-query',
      query: 'query'
    })
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      id: 1,
      type: 'embed-markdown',
      document: {
        name: 'Document',
        description: 'Description',
        content: 'Content'
      }
    })
  })

  it('does not start a worker only to dispose it', async () => {
    const embeddings = new EmbeddingWorker()
    await embeddings.dispose()
    expect(WorkerMock.instances).toHaveLength(0)
  })

  it('rejects pending requests when disposed', async () => {
    const embeddings = new EmbeddingWorker()
    const request = embeddings.embedQuery('query')
    const rejection = expect(request).rejects.toThrow('disposed')
    const worker = WorkerMock.instances[0]

    await embeddings.dispose()

    await rejection
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
