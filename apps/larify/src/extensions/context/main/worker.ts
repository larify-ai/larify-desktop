import { resolve } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { watch, type FSWatcher } from 'chokidar'
import { readContextDocument, type ContextDocument } from './document'
import { isMarkdown, isWithin } from './files'
import { type GraphIndex, type Node } from './graph'
import { buildContextGraph, memoryRootPath, updateContext } from './indexer'
import type { WorkerNotification, WorkerRequest, WorkerResponse } from './worker-protocol'

interface MemoryContext {
  graph: GraphIndex
  watcher: FSWatcher
}

let memory: MemoryContext | undefined
if (!parentPort) throw new Error('Context worker requires a parent port.')
const port = parentPort

port.on('message', async (request: WorkerRequest) => {
  try {
    const result = await handle(request)
    port.postMessage({ id: request.id, result } satisfies WorkerResponse)
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    } satisfies WorkerResponse)
  }
})

async function handle(
  request: WorkerRequest
): Promise<Node[] | ContextDocument | boolean | undefined> {
  switch (request.type) {
    case 'open':
      openMemory()
      return
    case 'search': {
      const { graph } = openMemory()
      return request.vector === undefined
        ? graph.search(request.query, request.limit)
        : graph.hybridSearch(request.query, request.vector, request.limit)
    }
    case 'pending-embedding': {
      const pending = openMemory().graph.pendingEmbedding()
      if (!pending) return
      const document = readContextDocument(fileURLToPath(pending.uri))
      return document?.hash === pending.hash ? document : undefined
    }
    case 'set-embeddings':
      openMemory().graph.setEmbeddings(request.uri, request.hash, request.vectors)
      return
    case 'duplicateName': {
      const root = memoryRootPath()
      const file = resolve(request.file)
      if (!isWithin(root, file) || !isMarkdown(file)) {
        throw new Error('Memory file must be Markdown within the memory directory.')
      }
      const { graph } = openMemory()
      updateContext(root, [file], graph)
      return graph.hasName(request.name, pathToFileURL(file).href)
    }
    case 'dispose':
      await closeMemory()
      return
    default:
      throw new Error('Unknown context worker request.')
  }
}

function openMemory(): MemoryContext {
  if (memory) return memory
  const root = memoryRootPath()
  const graph = buildContextGraph(root)
  try {
    const watcher = watch(root, { ignoreInitial: true, awaitWriteFinish: true })
    watcher.on('all', (_event, file) => {
      if (memory?.graph !== graph || !isMarkdown(file)) return
      try {
        updateContext(root, [file], graph)
        port.postMessage({ type: 'changed' } satisfies WorkerNotification)
      } catch (error) {
        console.error('[context:update]', error)
      }
    })
    watcher.on('error', (error) => console.error('[context:watch]', error))
    return (memory = { graph, watcher })
  } catch (error) {
    graph.close()
    throw error
  }
}

async function closeMemory(): Promise<void> {
  const current = memory
  if (!current) return
  memory = undefined
  try {
    await current.watcher.close()
  } finally {
    current.graph.close()
  }
}
