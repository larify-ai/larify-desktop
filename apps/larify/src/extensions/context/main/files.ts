import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Link } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'

export function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(file)
    return entry.isFile() && isMarkdown(file) ? [file] : []
  })
}

export function isMarkdown(file: string): boolean {
  return extname(file).toLowerCase() === '.md'
}

export function markdownLinks(content: string): Link[] {
  const links: Link[] = []
  visit(fromMarkdown(content), 'link', (link) => {
    links.push(link)
  })
  return links
}

export function isWithin(root: string, file: string): boolean {
  const path = relative(resolve(root), resolve(file))
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export function resolveContextLink(root: string, source: string, url: string): string | undefined {
  if (URL.canParse(url) || url.startsWith('#')) return
  try {
    let target = fileURLToPath(new URL(url, pathToFileURL(source)))
    if (!isWithin(root, target)) return
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'README.md')
    return resolve(target)
  } catch {
    return
  }
}
