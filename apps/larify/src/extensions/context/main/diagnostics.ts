import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { DiagnosticSeverity, Range, type Diagnostic } from 'vscode-languageserver-protocol'
import type { FileDiagnosticsProvider } from '../../file/main/diagnostics'
import { isMarkdown, isWithin, markdownLinks, resolveContextLink } from './files'

type DuplicateName = (file: string, name: string) => Promise<boolean>

export function createContextDiagnosticsProvider(
  root: string,
  duplicateName: DuplicateName
): FileDiagnosticsProvider {
  return {
    matches: (file) => isWithin(root, file) && isMarkdown(file),
    provide: async (file) => ({
      uri: pathToFileURL(file).href,
      diagnostics: await diagnose(root, file, duplicateName)
    })
  }
}

async function diagnose(
  root: string,
  file: string,
  duplicateName: DuplicateName
): Promise<Diagnostic[]> {
  const content = readFileSync(file, 'utf8')
  return [
    ...(await metadataDiagnostics(file, content, duplicateName)),
    ...linkDiagnostics(root, file, content)
  ]
}

async function metadataDiagnostics(
  file: string,
  content: string,
  duplicateName: DuplicateName
): Promise<Diagnostic[]> {
  let data: Record<string, unknown>
  try {
    data = matter(content).data
  } catch {
    return [diagnostic('Invalid YAML frontmatter.')]
  }

  const diagnostics = ['name', 'description'].flatMap((field) =>
    typeof data[field] === 'string' && data[field].trim()
      ? []
      : [diagnostic(`Missing frontmatter field: ${field}.`)]
  )
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (name && (await isDuplicate(file, name, duplicateName))) {
    diagnostics.push(diagnostic(`Name must be unique: ${name}.`))
  }
  return diagnostics
}

async function isDuplicate(
  file: string,
  name: string,
  duplicateName: DuplicateName
): Promise<boolean> {
  try {
    return await duplicateName(file, name)
  } catch {
    return false
  }
}

function linkDiagnostics(root: string, file: string, content: string): Diagnostic[] {
  return markdownLinks(content).flatMap((link) => {
    if (isWebUrl(link.url)) {
      return URL.canParse(link.url) ? [] : [diagnostic(`Invalid external URL: ${link.url}.`)]
    }
    if (isExternalUrl(link.url) || link.url.startsWith('#')) return []
    const target = resolveContextLink(root, file, link.url)
    if (!target || !existsSync(target)) {
      return [diagnostic(`Link target does not exist: ${link.url}.`)]
    }
    return []
  })
}

function isWebUrl(url: string): boolean {
  const value = url.toLowerCase()
  return value.startsWith('http:') || value.startsWith('https:')
}

function isExternalUrl(url: string): boolean {
  if (!URL.canParse(url)) return false
  return new URL(url).protocol.length > 2
}

function diagnostic(message: string): Diagnostic {
  return { range: Range.create(0, 0, 0, 1), severity: DiagnosticSeverity.Error, message }
}
