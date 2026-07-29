import { readFileSync, writeFileSync } from "node:fs"
import matter from "gray-matter"

export function read(path: string): {
  metadata: Record<string, unknown>
  body: string
} {
  const { data, content } = matter(readFileSync(path, "utf8"))
  return { metadata: data, body: content }
}

export function get(path: string, key: string): unknown {
  return read(path).metadata[key]
}

export function set(path: string, key: string, value: unknown): void {
  const { data, content } = matter(readFileSync(path, "utf8"))
  writeFileSync(path, matter.stringify(content, { ...data, [key]: value }))
}
