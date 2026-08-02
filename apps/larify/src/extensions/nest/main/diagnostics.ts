import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { DiagnosticSeverity, Range, type Diagnostic } from 'vscode-languageserver-protocol'
import type { FileDiagnosticsProvider } from '../../file/main/diagnostics'
import { isWithin } from '../../context/main/files'

const statuses = new Set(['in_progress', 'completed'])

export function createTaskDiagnosticsProvider(root: string): FileDiagnosticsProvider {
  return {
    matches: (file) => isWithin(root, file) && basename(file).toLowerCase() === 'task.md',
    provide: async (file) => ({
      uri: pathToFileURL(file).href,
      diagnostics: diagnose(readFileSync(file, 'utf8'))
    })
  }
}

function diagnose(content: string): Diagnostic[] {
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
  if (!statuses.has(data.status as string)) {
    diagnostics.push(diagnostic('Status must be in_progress or completed.'))
  }
  return diagnostics
}

function diagnostic(message: string): Diagnostic {
  return { range: Range.create(0, 0, 0, 1), severity: DiagnosticSeverity.Error, message }
}
