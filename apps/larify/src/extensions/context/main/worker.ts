import { join, resolve } from 'node:path'
import { parentPort } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { watch, type FSWatcher } from 'chokidar'
import { isMarkdown, isWithin } from './files'
import { type GraphIndex, type Node } from './graph'
import { buildContextGraph, updateContext } from './indexer'
import type { WorkerRequest, WorkerResponse } from './worker-protocol'

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

async function handle(request: WorkerRequest): Promise<Node[] | boolean | undefined> {
  switch (request.type) {
    case 'open':
      open(request.cwd)
      return
    case 'search': {
      const workspace = resolve(request.cwd)
      open(workspace)
      const context = contexts.get(workspace)!
      return context.graph.search(request.query, request.limit)
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
