import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { DiagnosticSeverity, Range, type Diagnostic } from 'vscode-languageserver-protocol'
import { larifyPath } from '../../../main/utils/app-paths'
import { splitLines } from '../../../main/utils/text'
import type { FileDiagnosticsProvider } from '../../file/main/diagnostics'
import { isMarkdown, isWithin, markdownFiles, markdownLinks, resolveContextLink } from './files'

const defaultLimits = { maxFileLines: 200, maxDirectoryEntries: 20 }

export function createContextDiagnosticsProvider(
  root = larifyPath('context'),
  limits = defaultLimits
): FileDiagnosticsProvider {
  return {
    matches: (file) => isWithin(root, file) && isMarkdown(file),
    provide: async (file) => ({
      uri: pathToFileURL(file).href,
      diagnostics: diagnose(root, file, limits)
    })
  }
}

function diagnose(root: string, file: string, limits: typeof defaultLimits): Diagnostic[] {
  const content = readFileSync(file, 'utf8')
  return [
    ...metadataDiagnostics(root, file, content),
    ...linkDiagnostics(root, file, content),
    ...sizeDiagnostics(file, content, limits)
  ]
}

function metadataDiagnostics(root: string, file: string, content: string): Diagnostic[] {
  let data: Record<string, unknown>
  try {
    data = matter(content).data
  } catch {
    return [diagnostic(DiagnosticSeverity.Error, 'Invalid YAML frontmatter.')]
  }

  const diagnostics = ['name', 'description'].flatMap((field) =>
    typeof data[field] === 'string' && data[field].trim()
      ? []
      : [diagnostic(DiagnosticSeverity.Error, `Missing frontmatter field: ${field}.`)]
  )
  if (typeof data.name === 'string' && data.name.trim() && duplicateName(root, file, data.name)) {
    diagnostics.push(diagnostic(DiagnosticSeverity.Error, `Name must be unique: ${data.name}.`))
  }
  return diagnostics
}

function linkDiagnostics(root: string, file: string, content: string): Diagnostic[] {
  return markdownLinks(content).flatMap((link) => {
    if (URL.canParse(link.url) || link.url.startsWith('#')) return []
    const target = resolveContextLink(root, file, link.url)
    if (!target || !existsSync(target)) {
      return [diagnostic(DiagnosticSeverity.Error, `Broken link: ${link.url}.`)]
    }
    return []
  })
}

function sizeDiagnostics(
  file: string,
  content: string,
  limits: typeof defaultLimits
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const lines = splitLines(content).length
  if (lines > limits.maxFileLines) {
    diagnostics.push(
      diagnostic(
        DiagnosticSeverity.Warning,
        `File has too many lines (${lines}); consider reorganizing its content and structure.`
      )
    )
  }

  const entries = readdirSync(dirname(file), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() || (entry.isFile() && isMarkdown(entry.name))
  ).length
  if (entries > limits.maxDirectoryEntries) {
    diagnostics.push(
      diagnostic(
        DiagnosticSeverity.Warning,
        `Directory has too many entries (${entries}); consider reorganizing its content and structure.`
      )
    )
  }
  return diagnostics
}

function duplicateName(root: string, file: string, name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return markdownFiles(root).some(
    (candidate) => candidate !== file && nameOf(candidate) === normalized
  )
}

function nameOf(file: string): string | undefined {
  try {
    const name = matter(readFileSync(file, 'utf8')).data.name
    return typeof name === 'string' ? name.trim().toLowerCase() : undefined
  } catch {
    return
  }
}

function diagnostic(severity: DiagnosticSeverity, message: string): Diagnostic {
  return { range: Range.create(0, 0, 0, 1), severity, message }
}
