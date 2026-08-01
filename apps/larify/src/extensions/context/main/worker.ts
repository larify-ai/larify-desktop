import { join, resolve } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { watch, type FSWatcher } from 'chokidar'
import { readContextDocument, type ContextDocument } from './document'
import { isMarkdown, isWithin } from './files'
import { type GraphIndex, type Node } from './graph'
import { buildContextGraph, updateContext } from './indexer'
import type { WorkerNotification, WorkerRequest, WorkerResponse } from './worker-protocol'

interface Context {
  graph: GraphIndex
  watcher: FSWatcher
}

const contexts = new Map<string, Context>()
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
      open(request.cwd)
      return
    case 'search': {
      const workspace = resolve(request.cwd)
      open(workspace)
      const context = contexts.get(workspace)!
      return request.vector !== undefined
        ? context.graph.hybridSearch(request.query, request.vector, request.limit)
        : context.graph.search(request.query, request.limit)
    }
    case 'pending-embedding': {
      const context = openContext(request.cwd)
      const pending = context.graph.pendingEmbedding()
      if (!pending) return
      const document = readContextDocument(fileURLToPath(pending.uri))
      if (document?.hash !== pending.hash) return
      return document
    }
    case 'set-embeddings': {
      const context = openContext(request.cwd)
      context.graph.setEmbeddings(request.uri, request.hash, request.vectors)
      return
    }
    case 'duplicateName': {
      const workspace = resolve(request.cwd)
      const context = contexts.get(workspace)
      if (!context) throw new Error('Context is not open.')
      const root = join(workspace, '.larify')
      const file = resolve(request.file)
      if (!isWithin(root, file) || !isMarkdown(file)) {
        throw new Error('Context file must be Markdown within .larify.')
      }
      updateContext(root, [file], context.graph)
      return context.graph.hasName(request.name, pathToFileURL(file).href)
    }
    case 'close':
      await close(request.cwd)
      return
    case 'dispose':
      await Promise.all([...contexts.keys()].map(close))
      return
    default:
      throw new Error('Unknown context worker request.')
  }
}

function openContext(cwd: string): Context {
  const workspace = resolve(cwd)
  open(workspace)
  return contexts.get(workspace)!
}

function open(cwd: string): void {
  const workspace = resolve(cwd)
  if (contexts.has(workspace)) return
  const root = join(workspace, '.larify')
  const graph = buildContextGraph(workspace)
  try {
    const watcher = watch(root, { ignoreInitial: true, awaitWriteFinish: true })
    watcher.on('all', (_event, file) => {
      if (!isMarkdown(file)) return
      try {
        updateContext(root, [file], graph)
        port.postMessage({ type: 'changed', cwd: workspace } satisfies WorkerNotification)
      } catch (error) {
        console.error('[context:update]', error)
      }
    })
    watcher.on('error', (error) => console.error('[context:watch]', error))
    contexts.set(workspace, { graph, watcher })
  } catch (error) {
    graph.close()
    throw error
  }
}

async function close(cwd: string): Promise<void> {
  const workspace = resolve(cwd)
  const context = contexts.get(workspace)
  if (!context) return
  contexts.delete(workspace)
  try {
    await context.watcher.close()
  } finally {
    context.graph.close()
  }
}
