import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  message: undefined as ((request: unknown) => Promise<void>) | undefined,
  postMessage: vi.fn(),
  graphs: [] as Array<{
    search: ReturnType<typeof vi.fn>
    pendingEmbedding: ReturnType<typeof vi.fn>
    setEmbeddings: ReturnType<typeof vi.fn>
    hybridSearch: ReturnType<typeof vi.fn>
    hasName: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }>,
  watchers: [] as Array<
    EventEmitter & {
      close: ReturnType<typeof vi.fn>
    }
  >,
  build: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  watch: vi.fn()
}))

vi.mock('node:worker_threads', () => ({
  parentPort: {
    on: (_event: string, handler: (request: unknown) => Promise<void>) => {
      mocks.message = handler
    },
    postMessage: mocks.postMessage
  }
}))

vi.mock('chokidar', () => ({
  watch: mocks.watch
}))

vi.mock('../../../../src/extensions/context/main/indexer', () => ({
  buildContextGraph: mocks.build,
  updateContext: mocks.update
}))

vi.mock('../../../../src/extensions/context/main/document', () => ({
  readContextDocument: mocks.read
}))

import '../../../../src/extensions/context/main/worker'

interface Request {
  id: number
  type: string
  [key: string]: unknown
}

function graph(): (typeof mocks.graphs)[number] {
  const value = {
    search: vi.fn(() => []),
    pendingEmbedding: vi.fn(),
    setEmbeddings: vi.fn(),
    hybridSearch: vi.fn(() => []),
    hasName: vi.fn(() => false),
    close: vi.fn()
  }
  mocks.graphs.push(value)
  return value
}

function watcher(): (typeof mocks.watchers)[number] {
  const value = Object.assign(new EventEmitter(), { close: vi.fn(async () => {}) })
  mocks.watchers.push(value)
  return value
}

async function send(request: Request): Promise<Record<string, unknown>> {
  if (!mocks.message) throw new Error('Worker message handler was not registered.')
  await mocks.message(request)
  return mocks.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

beforeEach(async () => {
  await send({ id: -1, type: 'dispose' })
  vi.clearAllMocks()
  mocks.graphs.length = 0
  mocks.watchers.length = 0
  mocks.build.mockImplementation(graph)
  mocks.read.mockImplementation((file: string) => ({
    node: { name: 'Audio', description: 'Audio', uri: pathToFileURL(file).href },
    content: 'Microphone',
    hash: 'hash'
  }))
  mocks.watch.mockImplementation(watcher)
})

describe('context worker', () => {
  it('opens each normalized workspace once and watches its context directory', async () => {
    const first = await send({ id: 1, type: 'open', cwd: 'workspace/../workspace' })
    const second = await send({ id: 2, type: 'open', cwd: 'workspace' })

    expect(first).toEqual({ id: 1, result: undefined })
    expect(second).toEqual({ id: 2, result: undefined })
    expect(mocks.build).toHaveBeenCalledOnce()
    expect(mocks.watch).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]workspace[\\/]\.larify$/),
      { ignoreInitial: true, awaitWriteFinish: true }
    )
  })

  it('searches an open context and opens another on demand', async () => {
    await send({ id: 1, type: 'open', cwd: 'workspace' })
    const result = [{ name: 'Audio', description: 'Audio', uri: 'file:///audio.md' }]
    mocks.graphs[0].search.mockReturnValue(result)

    expect(
      await send({ id: 2, type: 'search', cwd: 'workspace', query: 'audio', limit: 3 })
    ).toEqual({ id: 2, result })
    expect(mocks.graphs[0].search).toHaveBeenCalledWith('audio', 3)

    expect(await send({ id: 3, type: 'search', cwd: 'missing', query: 'audio' })).toEqual({
      id: 3,
      result: []
    })
    expect(mocks.build).toHaveBeenCalledTimes(2)
    expect(mocks.graphs[1].search).toHaveBeenCalledWith('audio', undefined)
  })

  it('reads and writes embeddings and performs hybrid search', async () => {
    await send({ id: 1, type: 'open', cwd: 'workspace' })
    const uri = pathToFileURL(resolve('audio.md')).href
    const documents = [
      {
        node: { name: 'Audio', description: 'Audio', uri },
        hash: 'hash',
        content: 'Microphone'
      }
    ]
    const result = [documents[0].node]
    mocks.graphs[0].pendingEmbedding.mockReturnValue({ ...documents[0].node, hash: 'hash' })
    mocks.graphs[0].hybridSearch.mockReturnValue(result)

    expect(await send({ id: 2, type: 'pending-embedding', cwd: 'workspace' })).toEqual({
      id: 2,
      result: documents[0]
    })
    expect(
      await send({
        id: 3,
        type: 'set-embeddings',
        cwd: 'workspace',
        uri,
        hash: 'hash',
        vectors: [[1, 0]]
      })
    ).toEqual({ id: 3, result: undefined })
    expect(mocks.graphs[0].setEmbeddings).toHaveBeenCalledWith(uri, 'hash', [[1, 0]])

    expect(
      await send({
        id: 4,
        type: 'search',
        cwd: 'workspace',
        query: 'audio',
        vector: [1, 0],
        limit: 5
      })
    ).toEqual({ id: 4, result })
    expect(mocks.graphs[0].hybridSearch).toHaveBeenCalledWith('audio', [1, 0], 5)
  })

  it('updates valid context files before checking duplicate names', async () => {
    await send({ id: 1, type: 'open', cwd: 'workspace' })
    mocks.graphs[0].hasName.mockReturnValue(true)
    const file = resolve('workspace/.larify/subject.md')

    expect(
      await send({
        id: 2,
        type: 'duplicateName',
        cwd: 'workspace',
        file,
        name: 'Subject'
      })
    ).toEqual({ id: 2, result: true })
    expect(mocks.update).toHaveBeenCalledWith(resolve('workspace/.larify'), [file], mocks.graphs[0])
    expect(mocks.graphs[0].hasName).toHaveBeenCalledWith('Subject', pathToFileURL(file).href)
  })

  it('rejects duplicate-name checks when context is closed', async () => {
    expect(
      await send({
        id: 1,
        type: 'duplicateName',
        cwd: 'workspace',
        file: resolve('workspace/.larify/subject.md'),
        name: 'Subject'
      })
    ).toEqual({ id: 1, error: 'Context is not open.' })
  })

  it('rejects duplicate-name checks outside context or for non-Markdown files', async () => {
    await send({ id: 1, type: 'open', cwd: 'workspace' })

    for (const file of [resolve('workspace/source.md'), resolve('workspace/.larify/data.json')]) {
      expect(
        await send({
          id: 2,
          type: 'duplicateName',
          cwd: 'workspace',
          file,
          name: 'Subject'
        })
      ).toEqual({ id: 2, error: 'Context file must be Markdown within .larify.' })
    }
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('updates changed Markdown files and ignores other files', async () => {
    await send({ id: 1, type: 'open', cwd: 'workspace' })
    const root = resolve('workspace/.larify')
    const markdown = resolve(root, 'subject.md')

    mocks.watchers[0].emit('all', 'change', resolve(root, 'data.json'))
    mocks.watchers[0].emit('all', 'change', markdown)

    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledWith(root, [markdown], mocks.graphs[0])
    expect(mocks.postMessage).toHaveBeenCalledWith({
      type: 'changed',
      cwd: resolve('workspace')
    })
  })

  it('isolates update and watcher errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await send({ id: 1, type: 'open', cwd: 'workspace' })
    const error = new Error('failed')
    mocks.update.mockImplementationOnce(() => {
      throw error
    })

    mocks.watchers[0].emit('all', 'change', resolve('workspace/.larify/subject.md'))
    mocks.watchers[0].emit('error', error)

    expect(log).toHaveBeenCalledWith('[context:update]', error)
    expect(log).toHaveBeenCalledWith('[context:watch]', error)
    log.mockRestore()
  })

  it('closes the graph if watcher setup fails', async () => {
    mocks.watch.mockImplementationOnce(() => {
      throw new Error('watch failed')
    })

    expect(await send({ id: 1, type: 'open', cwd: 'workspace' })).toEqual({
      id: 1,
      error: 'watch failed'
    })
    expect(mocks.graphs[0].close).toHaveBeenCalledOnce()
  })

  it('closes one workspace and always closes its graph', async () => {
    await send({ id: 1, type: 'open', cwd: 'workspace' })
    mocks.watchers[0].close.mockRejectedValueOnce(new Error('close failed'))

    expect(await send({ id: 2, type: 'close', cwd: 'workspace' })).toEqual({
      id: 2,
      error: 'close failed'
    })
    expect(mocks.graphs[0].close).toHaveBeenCalledOnce()
    expect(await send({ id: 3, type: 'close', cwd: 'workspace' })).toEqual({
      id: 3,
      result: undefined
    })
  })

  it('disposes every open workspace', async () => {
    await send({ id: 1, type: 'open', cwd: 'first' })
    await send({ id: 2, type: 'open', cwd: 'second' })

    expect(await send({ id: 3, type: 'dispose' })).toEqual({ id: 3, result: undefined })
    expect(mocks.watchers[0].close).toHaveBeenCalledOnce()
    expect(mocks.watchers[1].close).toHaveBeenCalledOnce()
    expect(mocks.graphs[0].close).toHaveBeenCalledOnce()
    expect(mocks.graphs[1].close).toHaveBeenCalledOnce()
  })

  it('serializes non-Error failures and rejects unknown requests', async () => {
    await send({ id: 1, type: 'open', cwd: 'workspace' })
    mocks.graphs[0].search.mockImplementationOnce(() => {
      throw 'search failed'
    })

    expect(await send({ id: 2, type: 'search', cwd: 'workspace', query: 'audio' })).toEqual({
      id: 2,
      error: 'search failed'
    })
    expect(await send({ id: 3, type: 'unknown' })).toEqual({
      id: 3,
      error: 'Unknown context worker request.'
    })
  })
})
