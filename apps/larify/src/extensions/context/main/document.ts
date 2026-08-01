import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import type { Node } from './graph'

export interface ContextDocument {
  node: Node
  content: string
  hash: string
}

export function readContextDocument(file: string): ContextDocument | undefined {
  try {
    const source = readFileSync(file, 'utf8')
    const { data, content } = matter(source)
    const name = text(data.name)
    const description = text(data.description)
    if (!name || !description) return
    return {
      node: { name, description, uri: pathToFileURL(resolve(file)).href },
      content,
      hash: createHash('sha256').update(source).digest('hex')
    }
  } catch {
    return
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
