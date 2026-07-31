import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { larifyPath } from '../../../main/utils/app-paths'
import { splitLines } from '../../../main/utils/text'
import { markdownFiles, markdownLinks, resolveContextLink } from './files'
import { GraphIndex, type Node } from './graph'

interface IndexedDocument {
  node: Node
  content: string
  edges: { targetUri: string; description: string }[]
  hash: string
}

export function buildContextGraph(
  root = larifyPath('context'),
  database = larifyPath('indexes', 'context.db')
): GraphIndex {
  const graph = new GraphIndex(database)
  indexContext(root, graph)
  return graph
}

export function indexContext(root: string, graph: GraphIndex): void {
  const files = markdownFiles(root)
  updateContext(root, files, graph)
  graph.deleteMissing(files.map((file) => pathToFileURL(resolve(file)).href))
}

export function updateContext(root: string, files: Iterable<string>, graph: GraphIndex): void {
  const documents = [...files].flatMap((file) => {
    const uri = pathToFileURL(resolve(file)).href
    const document = existsSync(file) ? parseDocument(root, file) : undefined
    if (document) return [document]
    graph.delete(uri)
    return []
  })

  const accepted = documents.filter(({ node, content, hash }) => graph.upsert(node, content, hash))
  for (const { node, edges } of accepted) graph.replaceEdges(node.uri, edges)
}

function parseDocument(root: string, file: string): IndexedDocument | undefined {
  try {
    const source = readFileSync(file, 'utf8')
    const { data, content } = matter(source)
    const name = text(data.name)
    const description = text(data.description)
    if (!name || !description) return
    return {
      node: {
        name,
        description,
        uri: pathToFileURL(resolve(file)).href
      },
      content,
      edges: edgesFrom(root, file, content),
      hash: createHash('sha256').update(source).digest('hex')
    }
  } catch {
    return
  }
}

function edgesFrom(
  root: string,
  source: string,
  content: string
): { targetUri: string; description: string }[] {
  const lines = splitLines(content)
  const edges: { targetUri: string; description: string }[] = []
  for (const link of markdownLinks(content)) {
    const target = resolveContextLink(root, source, link.url)
    if (target) {
      edges.push({
        targetUri: pathToFileURL(target).href,
        description: lines[(link.position?.start.line ?? 1) - 1]?.trim() ?? ''
      })
    }
  }
  return edges
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
