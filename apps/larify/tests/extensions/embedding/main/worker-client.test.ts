import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class WorkerMock extends EventEmitter {
  static instances: WorkerMock[] = []
  static postError: Error | undefined
  postMessage = vi.fn(() => {
    if (!WorkerMock.postError) return
    const error = WorkerMock.postError
    WorkerMock.postError = undefined
    throw error
  })
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
  WorkerMock.postError = undefined
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

  it('matches concurrent responses by id regardless of response order', async () => {
    const embeddings = new EmbeddingWorker()
    const first = embeddings.embedQuery('first')
    const second = embeddings.embedQuery('second')
    const worker = WorkerMock.instances[0]

    worker.emit('message', { id: 1, result: [2] })
    worker.emit('message', { id: 0, result: [1] })

    await expect(first).resolves.toEqual([1])
    await expect(second).resolves.toEqual([2])
  })

  it('ignores responses for unknown request ids', async () => {
    const embeddings = new EmbeddingWorker()
    const request = embeddings.embedQuery('query')
    const worker = WorkerMock.instances[0]

    worker.emit('message', { id: 99, result: [99] })
    worker.emit('message', { id: 0, result: [1] })

    await expect(request).resolves.toEqual([1])
  })

  it('rejects an error response without affecting other requests', async () => {
    const embeddings = new EmbeddingWorker()
    const failed = embeddings.embedQuery('failed')
    const successful = embeddings.embedQuery('successful')
    const worker = WorkerMock.instances[0]

    worker.emit('message', { id: 0, error: 'model failed' })
    worker.emit('message', { id: 1, result: [1] })

    await expect(failed).rejects.toThrow('model failed')
    await expect(successful).resolves.toEqual([1])
  })

  it('rejects a failed post without affecting later requests', async () => {
    const embeddings = new EmbeddingWorker()
    WorkerMock.postError = new Error('post failed')

    await expect(embeddings.embedQuery('first')).rejects.toThrow('post failed')

    const successful = embeddings.embedQuery('second')
    WorkerMock.instances[0].emit('message', { id: 1, result: [2] })
    await expect(successful).resolves.toEqual([2])
  })

  it('rejects pending requests and starts a new worker after an error', async () => {
    const embeddings = new EmbeddingWorker()
    const failed = embeddings.embedQuery('first')
    const firstWorker = WorkerMock.instances[0]
    firstWorker.emit('error', new Error('worker failed'))

    await expect(failed).rejects.toThrow('worker failed')

    const retried = embeddings.embedQuery('second')
    const secondWorker = WorkerMock.instances[1]
    secondWorker.emit('message', { id: 1, result: [2] })

    await expect(retried).resolves.toEqual([2])
    expect(secondWorker).not.toBe(firstWorker)
  })

  it('ignores errors from a replaced worker', async () => {
    const embeddings = new EmbeddingWorker()
    const first = embeddings.embedQuery('first')
    const oldWorker = WorkerMock.instances[0]
    oldWorker.emit('error', new Error('worker failed'))
    await expect(first).rejects.toThrow('worker failed')

    const second = embeddings.embedQuery('second')
    const currentWorker = WorkerMock.instances[1]
    oldWorker.emit('error', new Error('late error'))
    currentWorker.emit('message', { id: 1, result: [2] })

    await expect(second).resolves.toEqual([2])
  })

  it('ignores exits from a replaced worker', async () => {
    const embeddings = new EmbeddingWorker()
    const first = embeddings.embedQuery('first')
    const oldWorker = WorkerMock.instances[0]
    oldWorker.emit('exit', 1)
    await expect(first).rejects.toThrow('exited with code 1')

    const second = embeddings.embedQuery('second')
    const currentWorker = WorkerMock.instances[1]
    oldWorker.emit('exit', 1)
    currentWorker.emit('message', { id: 1, result: [2] })

    await expect(second).resolves.toEqual([2])
  })

  it('rejects pending requests and restarts after an unexpected exit', async () => {
    const embeddings = new EmbeddingWorker()
    const failed = embeddings.embedQuery('first')
    const firstWorker = WorkerMock.instances[0]
    firstWorker.emit('exit', 1)

    await expect(failed).rejects.toThrow('exited with code 1')

    const retried = embeddings.embedQuery('second')
    const secondWorker = WorkerMock.instances[1]
    secondWorker.emit('message', { id: 1, result: [2] })
    await expect(retried).resolves.toEqual([2])
  })

  it('can be disposed repeatedly', async () => {
    const embeddings = new EmbeddingWorker()
    const request = embeddings.embedQuery('query')
    const rejection = expect(request).rejects.toThrow('disposed')

    await embeddings.dispose()
    await embeddings.dispose()

    await rejection
    expect(WorkerMock.instances[0].terminate).toHaveBeenCalledOnce()
  })
})
