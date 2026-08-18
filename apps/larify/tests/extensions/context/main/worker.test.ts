import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  message: undefined as ((request: Record<string, unknown>) => Promise<void>) | undefined,
  postMessage: vi.fn(),
  graph: {
    search: vi.fn(),
    hybridSearch: vi.fn(),
    pendingEmbedding: vi.fn(),
    setEmbeddings: vi.fn(),
    hasName: vi.fn(),
    close: vi.fn()
  },
  watcher: undefined as
    (EventEmitter & { close: ReturnType<typeof vi.fn<() => Promise<void>>> }) | undefined,
  build: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  watch: vi.fn()
}))

vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: (_event: string, handler: (request: Record<string, unknown>) => Promise<void>) =>
      (mocks.message = handler),
    postMessage: mocks.postMessage
  }
}))
vi.mock('chokidar', () => ({ watch: mocks.watch }))
vi.mock('../../../../src/extensions/context/main/indexer', () => ({
  memoryRootPath: () => resolve('memory'),
  buildContextGraph: mocks.build,
  updateContext: mocks.update
}))
vi.mock('../../../../src/extensions/context/main/document', () => ({
  readContextDocument: mocks.read
}))

import '../../../../src/extensions/context/main/worker'

async function send(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  await mocks.message?.(request)
  return mocks.postMessage.mock.calls.at(-1)?.[0]
}

beforeEach(async () => {
  await send({ id: -1, type: 'dispose' })
  vi.clearAllMocks()
  mocks.build.mockReturnValue(mocks.graph)
  mocks.watcher = Object.assign(new EventEmitter(), { close: vi.fn(async () => {}) })
  mocks.watch.mockReturnValue(mocks.watcher)
  mocks.graph.search.mockReturnValue([])
  mocks.graph.hybridSearch.mockReturnValue([])
  mocks.graph.pendingEmbedding.mockReturnValue(undefined)
  mocks.graph.hasName.mockReturnValue(false)
})

describe('context worker', () => {
  it('opens one shared memory graph and watcher', async () => {
    expect(await send({ id: 1, type: 'open' })).toEqual({ id: 1, result: undefined })
    expect(await send({ id: 2, type: 'open' })).toEqual({ id: 2, result: undefined })
    expect(mocks.build).toHaveBeenCalledOnce()
    expect(mocks.watch).toHaveBeenCalledWith(resolve('memory'), {
      ignoreInitial: true,
      awaitWriteFinish: true
    })
  })

  it('performs lexical and hybrid searches', async () => {
    await send({ id: 1, type: 'search', query: 'audio', limit: 3 })
    expect(mocks.graph.search).toHaveBeenCalledWith('audio', 3)
    await send({ id: 2, type: 'search', query: 'audio', vector: [1], limit: 2 })
    expect(mocks.graph.hybridSearch).toHaveBeenCalledWith('audio', [1], 2)
  })

  it('reads and writes pending embeddings', async () => {
    const file = resolve('memory', 'audio.md')
    const document = {
      node: { name: 'Audio', description: 'Audio', uri: pathToFileURL(file).href },
      content: 'Microphone',
      hash: 'hash'
    }
    mocks.graph.pendingEmbedding.mockReturnValue(
      document.node ? { uri: document.node.uri, hash: 'hash' } : undefined
    )
    mocks.read.mockReturnValue(document)
    expect(await send({ id: 1, type: 'pending-embedding' })).toEqual({ id: 1, result: document })
    await send({
      id: 2,
      type: 'set-embeddings',
      uri: document.node.uri,
      hash: 'hash',
      vectors: [[1]]
    })
    expect(mocks.graph.setEmbeddings).toHaveBeenCalledWith(document.node.uri, 'hash', [[1]])
  })

  it('updates valid memory files before duplicate checks', async () => {
    const file = resolve('memory', 'subject.md')
    await send({ id: 1, type: 'duplicateName', file, name: 'Subject' })
    expect(mocks.update).toHaveBeenCalledWith(resolve('memory'), [file], mocks.graph)
    expect(mocks.graph.hasName).toHaveBeenCalledWith('Subject', pathToFileURL(file).href)
  })

  it('rejects files outside shared memory', async () => {
    const result = await send({
      id: 1,
      type: 'duplicateName',
      file: resolve('outside.md'),
      name: 'Outside'
    })
    expect(result.error).toContain('within the memory directory')
  })

  it('updates changed Markdown and notifies the client', async () => {
    await send({ id: 1, type: 'open' })
    mocks.watcher!.emit('all', 'change', resolve('memory', 'a.md'))
    expect(mocks.update).toHaveBeenCalled()
    expect(mocks.postMessage).toHaveBeenCalledWith({ type: 'changed' })
  })

  it('closes watcher and graph on disposal', async () => {
    await send({ id: 1, type: 'open' })
    const watcher = mocks.watcher!
    await send({ id: 2, type: 'dispose' })
    expect(watcher.close).toHaveBeenCalledOnce()
    expect(mocks.graph.close).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    watcher.emit('all', 'change', resolve('memory', 'stale.md'))
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.postMessage).not.toHaveBeenCalled()
  })

  it('closes the graph when watcher creation fails', async () => {
    mocks.watch.mockImplementationOnce(() => {
      throw new Error('watch failed')
    })
    expect(await send({ id: 1, type: 'open' })).toEqual({ id: 1, error: 'watch failed' })
    expect(mocks.graph.close).toHaveBeenCalledOnce()
  })

  it('closes the graph when watcher shutdown fails', async () => {
    await send({ id: 1, type: 'open' })
    mocks.watcher!.close.mockRejectedValueOnce(new Error('close failed'))
    expect(await send({ id: 2, type: 'dispose' })).toEqual({ id: 2, error: 'close failed' })
    expect(mocks.graph.close).toHaveBeenCalledOnce()
  })

  it('serializes unknown request errors', async () => {
    expect(await send({ id: 1, type: 'unknown' })).toEqual({
      id: 1,
      error: 'Unknown context worker request.'
    })
  })
})
