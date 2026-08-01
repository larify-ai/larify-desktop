import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddingWorkerRequest } from '../../../../src/extensions/embedding/main/worker-protocol'

const mocks = vi.hoisted(() => ({
  listener: undefined as ((request: EmbeddingWorkerRequest) => Promise<void>) | undefined,
  postMessage: vi.fn(),
  embedQuery: vi.fn(),
  embedDocuments: vi.fn(),
  tokenCounter: vi.fn(),
  chunkMarkdown: vi.fn()
}))

vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: vi.fn((_event, listener) => {
      mocks.listener = listener
    }),
    postMessage: mocks.postMessage
  }
}))

vi.mock('../../../../src/extensions/embedding/main/service', () => ({
  EmbeddingService: class {
    embedQuery = mocks.embedQuery
    embedDocuments = mocks.embedDocuments
    tokenCounter = mocks.tokenCounter
  }
}))

vi.mock('../../../../src/extensions/embedding/main/chunker', () => ({
  chunkMarkdown: mocks.chunkMarkdown
}))

await import('../../../../src/extensions/embedding/main/worker')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Embedding worker', () => {
  it('embeds a query and returns its request id', async () => {
    mocks.embedQuery.mockResolvedValue([1, 2])

    await mocks.listener?.({ id: 7, type: 'embed-query', query: 'query' })

    expect(mocks.embedQuery).toHaveBeenCalledWith('query')
    expect(mocks.postMessage).toHaveBeenCalledWith({ id: 7, result: [1, 2] })
  })

  it('chunks and embeds a Markdown document', async () => {
    const document = { name: 'Name', description: 'Description', content: 'Content' }
    const countTokens = vi.fn()
    mocks.tokenCounter.mockResolvedValue(countTokens)
    mocks.chunkMarkdown.mockReturnValue(['first', 'second'])
    mocks.embedDocuments.mockResolvedValue([[1], [2]])

    await mocks.listener?.({ id: 8, type: 'embed-markdown', document })

    expect(mocks.chunkMarkdown).toHaveBeenCalledWith(document, countTokens)
    expect(mocks.embedDocuments).toHaveBeenCalledWith(['first', 'second'])
    expect(mocks.postMessage).toHaveBeenCalledWith({ id: 8, result: [[1], [2]] })
  })

  it('returns errors without terminating the worker', async () => {
    mocks.embedQuery.mockRejectedValue(new Error('model failed'))

    await mocks.listener?.({ id: 9, type: 'embed-query', query: 'query' })

    expect(mocks.postMessage).toHaveBeenCalledWith({ id: 9, error: 'model failed' })
  })

  it('rejects unknown request types', async () => {
    await mocks.listener?.({ id: 10, type: 'unknown' } as never)

    expect(mocks.postMessage).toHaveBeenCalledWith({
      id: 10,
      error: 'Unknown embedding worker request.'
    })
  })
})
