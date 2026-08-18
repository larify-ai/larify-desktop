import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureLarifyPath } from '../../../main/utils/app-paths'
import { readContextDocument, type ContextDocument } from './document'
import { isMarkdown, isWithin, markdownFiles, markdownLinks, resolveContextLink } from './files'
import { GraphIndex } from './graph'

export const memoryRootPath = (): string => ensureLarifyPath('memory')
export const memoryIndexPath = (): string => join(ensureLarifyPath('indexes'), 'memory.db')

export function buildContextGraph(
  root = memoryRootPath(),
  database = memoryIndexPath()
): GraphIndex {
  const graph = new GraphIndex(database)
  try {
    indexContext(root, graph)
    return graph
  } catch (error) {
    graph.close()
    throw error
  }
}

export function indexContext(root: string, graph: GraphIndex): void {
  const files = markdownFiles(root).sort()
  graph.deleteMissing(files.map(fileUri))
  updateDocuments(root, files, graph)
}

export function updateContext(root: string, files: Iterable<string>, graph: GraphIndex): void {
  if (updateDocuments(root, files, graph)) indexContext(root, graph)
}

function updateDocuments(root: string, files: Iterable<string>, graph: GraphIndex): boolean {
  const documents = [...files].map((file) => {
    const path = resolve(file)
    const uri = fileUri(path)
    return {
      path,
      previous: graph.node(uri),
      document: existsSync(path) ? readContextDocument(path) : undefined
    }
  })

  for (const { path, document } of documents) {
    if (!document) graph.delete(fileUri(path))
  }
  const indexed: { path: string; document: ContextDocument }[] = []
  for (const { path, document } of documents) {
    if (!document) continue
    if (graph.upsert(document.node, document.content, document.hash)) {
      indexed.push({ path, document })
    } else {
      graph.delete(document.node.uri)
    }
  }
  for (const { path, document } of indexed) {
    graph.replaceEdges(document.node.uri, readContextEdges(root, path, document.content))
  }
  return documents.some(({ previous, document }) =>
    Boolean(previous && previous.name !== document?.node.name)
  )
}

function readContextEdges(root: string, source: string, content: string): string[] {
  return markdownLinks(content).flatMap((link) => {
    const target = resolveContextLink(root, source, link.url)
    return target && isWithin(root, target) && isMarkdown(target)
      ? [pathToFileURL(target).href]
      : []
  })
}

function fileUri(file: string): string {
  return pathToFileURL(resolve(file)).href
}
