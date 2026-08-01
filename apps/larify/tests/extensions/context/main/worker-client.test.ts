import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class WorkerMock extends EventEmitter {
  static instances: WorkerMock[] = []
  static postError?: Error
  static terminateError?: Error
  postMessage = vi.fn(() => {
    if (WorkerMock.postError) throw WorkerMock.postError
  })
  terminate = vi.fn(async () => {
    if (WorkerMock.terminateError) throw WorkerMock.terminateError
    return 0
  })

  constructor() {
    super()
    WorkerMock.instances.push(this)
  }
}

vi.mock('../../../../src/extensions/context/main/worker?nodeWorker', () => ({
  default: () => new WorkerMock()
}))

import { ContextWorker } from '../../../../src/extensions/context/main/worker-client'

beforeEach(() => {
  WorkerMock.instances.length = 0
  WorkerMock.postError = undefined
  WorkerMock.terminateError = undefined
  vi.clearAllMocks()
})

describe('ContextWorker', () => {
  it('resolves responses from one shared worker', async () => {
    const context = new ContextWorker()
    const opened = context.open('workspace')
    const worker = WorkerMock.instances[0]
    worker.emit('message', { id: 0 })
    await opened

    const searched = context.search('workspace', 'audio')
    worker.emit('message', {
      id: 1,
      result: [{ name: 'Audio', description: 'Audio', uri: 'file:///audio.md' }]
    })

    await expect(searched).resolves.toHaveLength(1)
    expect(WorkerMock.instances).toHaveLength(1)
  })

  it('searches immediately while stale documents update in the background', async () => {
    const embeddings = {
      embedMarkdown: vi.fn(async () => [
        [3, 0],
        [1, 0]
      ]),
      embedQuery: vi.fn(async () => [0, 1])
    }
    const context = new ContextWorker(() => embeddings as never)
    const searched = context.search('workspace', 'audio', 5)
    const worker = WorkerMock.instances[0]

    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 0,
      type: 'pending-embedding',
      cwd: 'workspace'
    })

    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith({
        id: 1,
        type: 'search',
        cwd: 'workspace',
        query: 'audio',
        vector: [0, 1],
        limit: 5
      })
    )
    worker.emit('message', {
      id: 1,
      result: [{ name: 'Audio', description: 'Audio input', uri: 'file:///audio.md' }]
    })
    await expect(searched).resolves.toHaveLength(1)

    worker.emit('message', {
      id: 0,
      result: {
        node: {
          name: 'Audio',
          description: 'Audio input',
          uri: 'file:///audio.md'
        },
        hash: 'hash',
        content: 'Microphone'
      }
    })

    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith({
        id: 2,
        type: 'set-embeddings',
        cwd: 'workspace',
        uri: 'file:///audio.md',
        hash: 'hash',
        vectors: [
          [3, 0],
          [1, 0]
        ]
      })
    )
    worker.emit('message', { id: 2 })
    expect(embeddings.embedMarkdown).toHaveBeenCalledWith({
      name: 'Audio',
      description: 'Audio input',
      content: 'Microphone'
    })
  })

  it('updates embeddings after a context file changes', async () => {
    const embeddings = { embedMarkdown: vi.fn(), embedQuery: vi.fn() }
    const context = new ContextWorker(() => embeddings as never)
    const opened = context.open('workspace')
    const worker = WorkerMock.instances[0]

    worker.emit('message', { id: 0 })
    await opened
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, type: 'pending-embedding' })
    )
    worker.emit('message', { id: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    worker.emit('message', { type: 'changed', cwd: 'workspace' })
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, type: 'pending-embedding' })
      )
    )
    worker.emit('message', { id: 2 })
  })

  it('does not write embeddings after a workspace closes', async () => {
    let finishEmbedding!: (vectors: number[][]) => void
    const embeddings = {
      embedMarkdown: vi.fn(() => new Promise<number[][]>((resolve) => (finishEmbedding = resolve))),
      embedQuery: vi.fn(async () => [1, 0])
    }
    const context = new ContextWorker(() => embeddings as never)
    const searched = context.search('workspace', 'audio')
    const worker = WorkerMock.instances[0]

    worker.emit('message', {
      id: 0,
      result: {
        node: {
          name: 'Audio',
          description: 'Audio input',
          uri: 'file:///audio.md'
        },
        hash: 'hash',
        content: 'Microphone'
      }
    })
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, type: 'search' })
      )
    )
    worker.emit('message', { id: 1, result: [] })
    await searched
    await vi.waitFor(() => expect(embeddings.embedMarkdown).toHaveBeenCalledOnce())

    const closed = context.close('workspace')
    worker.emit('message', { id: 2 })
    await closed
    finishEmbedding([[1, 0]])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(worker.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'set-embeddings' })
    )
  })

  it('does not restart after disposal while an embedding is running', async () => {
    let finishEmbedding!: (vectors: number[][]) => void
    const embeddings = {
      embedMarkdown: vi.fn(() => new Promise<number[][]>((resolve) => (finishEmbedding = resolve))),
      embedQuery: vi.fn(async () => [1, 0])
    }
    const context = new ContextWorker(() => embeddings as never)
    const searched = context.search('workspace', 'audio')
    const worker = WorkerMock.instances[0]

    worker.emit('message', {
      id: 0,
      result: {
        node: { name: 'Audio', description: '', uri: 'file:///audio.md' },
        hash: 'hash',
        content: 'Microphone'
      }
    })
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, type: 'search' })
      )
    )
    worker.emit('message', { id: 1, result: [] })
    await searched
    await vi.waitFor(() => expect(embeddings.embedMarkdown).toHaveBeenCalledOnce())

    const disposal = context.dispose()
    worker.emit('message', { id: 2 })
    await disposal
    finishEmbedding([[1, 0]])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(WorkerMock.instances).toHaveLength(1)
  })

  it('falls back to lexical search when query embedding fails', async () => {
    const embeddings = {
      embedMarkdown: vi.fn(),
      embedQuery: vi.fn(async () => {
        throw new Error('model unavailable')
      })
    }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const context = new ContextWorker(() => embeddings as never)
    const searched = context.search('workspace', 'audio')
    const worker = WorkerMock.instances[0]

    worker.emit('message', {
      id: 0,
      result: undefined
    })
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith({
        id: 1,
        type: 'search',
        cwd: 'workspace',
        query: 'audio',
        limit: undefined
      })
    )
    worker.emit('message', { id: 1 })

    await expect(searched).resolves.toEqual([])
    expect(log).toHaveBeenCalledWith('[context:embedding]', expect.any(Error))
    log.mockRestore()
  })

  it('shares background synchronization across concurrent searches', async () => {
    const embeddings = {
      embedMarkdown: vi.fn(async () => [[1, 0]]),
      embedQuery: vi.fn(async () => [1, 0])
    }
    const context = new ContextWorker(() => embeddings as never)
    const first = context.search('workspace', 'first')
    const second = context.search('workspace', 'second')
    const worker = WorkerMock.instances[0]
    const document = {
      node: {
        name: 'Audio',
        description: 'Audio input',
        uri: 'file:///audio.md'
      },
      hash: 'hash',
      content: 'Microphone'
    }

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3))
    worker.emit('message', { id: 1, result: [] })
    worker.emit('message', { id: 2, result: [] })
    await Promise.all([first, second])

    worker.emit('message', { id: 0, result: document })
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3, type: 'set-embeddings' })
      )
    )
    worker.emit('message', { id: 3 })
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 4, type: 'pending-embedding' })
      )
    )
    worker.emit('message', { id: 4 })

    expect(embeddings.embedMarkdown).toHaveBeenCalledOnce()
    expect(worker.postMessage).toHaveBeenCalledTimes(5)
  })

  it('checks duplicate names through the worker', async () => {
    const context = new ContextWorker()
    const duplicate = context.duplicateName('workspace', 'subject.md', 'Subject')
    const worker = WorkerMock.instances[0]
    worker.emit('message', { id: 0, result: true })

    await expect(duplicate).resolves.toBe(true)
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 0,
      type: 'duplicateName',
      cwd: 'workspace',
      file: 'subject.md',
      name: 'Subject'
    })
  })

  it('returns defaults for empty search and duplicate-name responses', async () => {
    const context = new ContextWorker()
    const search = context.search('workspace', 'audio', 5)
    const worker = WorkerMock.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 0,
      type: 'search',
      cwd: 'workspace',
      query: 'audio',
      limit: 5
    })
    worker.emit('message', { id: 0 })
    await expect(search).resolves.toEqual([])

    const duplicate = context.duplicateName('workspace', 'subject.md', 'Subject')
    worker.emit('message', { id: 1 })
    await expect(duplicate).resolves.toBe(false)
  })

  it('returns empty results without starting workers for empty queries', async () => {
    const embeddings = { embedMarkdown: vi.fn(), embedQuery: vi.fn() }
    const context = new ContextWorker(() => embeddings as never)

    await expect(context.search('workspace', '   ')).resolves.toEqual([])
    await expect(context.search('workspace', 'audio', 0)).resolves.toEqual([])
    expect(WorkerMock.instances).toHaveLength(0)
    expect(embeddings.embedQuery).not.toHaveBeenCalled()
  })

  it('matches concurrent requests to out-of-order responses', async () => {
    const context = new ContextWorker()
    const first = context.search('workspace', 'first')
    const second = context.search('workspace', 'second')
    const worker = WorkerMock.instances[0]

    worker.emit('message', {
      id: 1,
      result: [{ name: 'Second', description: '', uri: 'file:///second.md' }]
    })
    worker.emit('message', {
      id: 0,
      result: [{ name: 'First', description: '', uri: 'file:///first.md' }]
    })

    await expect(first).resolves.toEqual([
      { name: 'First', description: '', uri: 'file:///first.md' }
    ])
    await expect(second).resolves.toEqual([
      { name: 'Second', description: '', uri: 'file:///second.md' }
    ])
  })

  it('sends close requests and propagates response errors', async () => {
    const context = new ContextWorker()
    const closed = context.close('workspace')
    const worker = WorkerMock.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 0,
      type: 'close',
      cwd: 'workspace'
    })
    worker.emit('message', { id: 0 })
    await expect(closed).resolves.toBeUndefined()

    const close = context.close('workspace')
    worker.emit('message', { id: 1, error: 'close failed' })
    await expect(close).rejects.toThrow('close failed')
  })

  it('rejects a request when posting fails', async () => {
    WorkerMock.postError = new Error('post failed')
    const context = new ContextWorker()
    const request = context.open('workspace')

    await expect(request).rejects.toThrow('post failed')
  })

  it('ignores responses for unknown requests', async () => {
    const context = new ContextWorker()
    const request = context.open('workspace')
    const worker = WorkerMock.instances[0]

    worker.emit('message', { id: 99 })
    worker.emit('message', { id: 0 })
    await expect(request).resolves.toBeUndefined()
  })

  it('does nothing when disposed before the worker starts', async () => {
    const context = new ContextWorker()

    await expect(context.dispose()).resolves.toBeUndefined()
    expect(WorkerMock.instances).toHaveLength(0)
  })

  it('terminates the worker after successful disposal', async () => {
    const context = new ContextWorker()
    const opened = context.open('workspace')
    const worker = WorkerMock.instances[0]
    worker.emit('message', { id: 0 })
    await opened

    const disposal = context.dispose()
    worker.emit('message', { id: 1 })
    await expect(disposal).resolves.toBeUndefined()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('terminates the worker when disposal fails', async () => {
    const context = new ContextWorker()
    const opened = context.open('workspace')
    const worker = WorkerMock.instances[0]
    worker.emit('message', { id: 0 })
    await opened

    const disposal = context.dispose()
    const rejection = expect(disposal).rejects.toThrow('dispose failed')
    worker.emit('message', { id: 1, error: 'dispose failed' })

    await rejection
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('clears the worker even when termination fails', async () => {
    WorkerMock.terminateError = new Error('terminate failed')
    const context = new ContextWorker()
    const opened = context.open('workspace')
    const first = WorkerMock.instances[0]
    first.emit('message', { id: 0 })
    await opened

    const disposal = context.dispose()
    first.emit('message', { id: 1 })
    await expect(disposal).rejects.toThrow('terminate failed')

    WorkerMock.terminateError = undefined
    const reopened = context.open('workspace')
    const second = WorkerMock.instances[1]
    second.emit('message', { id: 2 })
    await reopened
    expect(second).toBeDefined()
  })

  it('does not clear a replacement worker when the previous worker finishes terminating', async () => {
    const context = new ContextWorker()
    const opened = context.open('workspace')
    const first = WorkerMock.instances[0]
    first.emit('message', { id: 0 })
    await opened

    let finishTermination!: () => void
    first.terminate.mockImplementationOnce(
      () => new Promise<number>((resolve) => (finishTermination = () => resolve(0)))
    )
    const disposal = context.dispose()
    first.emit('message', { id: 1 })
    await vi.waitFor(() => expect(first.terminate).toHaveBeenCalledOnce())
    first.emit('exit', 0)

    const reopened = context.open('workspace')
    const second = WorkerMock.instances[1]
    second.emit('message', { id: 2 })
    await reopened
    finishTermination()
    await disposal

    const search = context.search('workspace', 'audio')
    second.emit('message', { id: 3, result: [] })
    await search
    expect(WorkerMock.instances).toHaveLength(2)
  })

  it('rejects all pending requests when the worker errors', async () => {
    const context = new ContextWorker()
    const first = context.open('first')
    const second = context.open('second')
    const worker = WorkerMock.instances[0]
    const firstRejection = expect(first).rejects.toThrow('worker failed')
    const secondRejection = expect(second).rejects.toThrow('worker failed')

    worker.emit('error', new Error('worker failed'))

    await firstRejection
    await secondRejection

    const reopened = context.open('third')
    const replacement = WorkerMock.instances[1]
    worker.emit('error', new Error('late worker error'))
    replacement.emit('message', { id: 2 })
    await expect(reopened).resolves.toBeUndefined()
  })

  it('rejects pending requests when the worker exits', async () => {
    const context = new ContextWorker()
    const request = context.open('workspace')
    const rejection = expect(request).rejects.toThrow('exited with code 1')
    const worker = WorkerMock.instances[0]
    worker.emit('exit', 1)
    await rejection
  })

  it('starts a new worker after a normal exit', async () => {
    const context = new ContextWorker()
    const opened = context.open('workspace')
    const first = WorkerMock.instances[0]
    first.emit('message', { id: 0 })
    await opened
    first.emit('exit', 0)

    const reopened = context.open('workspace')
    const second = WorkerMock.instances[1]
    second.emit('message', { id: 1 })
    await reopened

    expect(WorkerMock.instances).toHaveLength(2)
  })
})
