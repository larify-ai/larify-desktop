import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { type Diagnostic } from 'vscode-languageserver-protocol'
import type { FileDiagnosticsProvider } from '../../fs/main/diagnostics'
import { diagnostic, requiredFieldDiagnostics } from './diagnostics'
import { isWithin } from './files'

// 任务状态只有两个：pending（待办）与 completed（已完成）。历史值 `in_progress` 已弃用。
const TASK_STATUSES = ['pending', 'completed'] as const

export function createTaskDiagnosticsProvider(root: string): FileDiagnosticsProvider {
  return {
    matches: (file) => isWithin(root, file) && basename(file).toLowerCase() === 'task.md',
    provide: async (file) => ({
      uri: pathToFileURL(file).href,
      diagnostics: diagnose(file)
    })
  }
}

function diagnose(file: string): Diagnostic[] {
  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    return []
  }

  let data: Record<string, unknown>
  try {
    data = matter(source).data
  } catch {
    return [diagnostic('Invalid YAML frontmatter.')]
  }

  const diagnostics = requiredFieldDiagnostics(data, ['name', 'description'])
  const status = data.status
  if (typeof status !== 'string' || !(TASK_STATUSES as readonly string[]).includes(status)) {
    diagnostics.push(
      diagnostic(`Frontmatter field "status" must be one of: ${TASK_STATUSES.join(' | ')}.`)
    )
  }
  return diagnostics
}
