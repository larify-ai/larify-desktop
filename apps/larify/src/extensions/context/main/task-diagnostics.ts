import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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
  if (status === 'completed') diagnostics.push(...unfinishedChildren(file))
  return diagnostics
}

/**
 * 一致性护栏：任务树父子关系由目录结构唯一确定（`<tasks>/A/B/task.md` 的父是
 * `<tasks>/A/task.md`）。某 task.md 标 `completed` 时，其**直接子任务**若还有未完成的
 * task.md，则它不该被视为完成——否则「回父」轮读到 `completed` 会空转、整条链提前终止
 * （真实事故：根任务永远停在 `pending`）。
 *
 * 只产出**告警式**诊断（不阻止写入）：`fs_write`/`fs_edit` 写完后会把诊断文本回传给模型。
 *
 * 「子任务」判据：**直接子目录中存在 `task.md`**（任务目录里可能还有 outputs/ 等非任务
 * 子目录，不能误报）。该 task.md 的 status 非 `completed`（缺失 / 非法一律视为未完成）即点名。
 */
function unfinishedChildren(file: string): Diagnostic[] {
  const directory = dirname(file)
  let names: string[]
  try {
    names = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const unfinished = names
    .filter((name) => {
      const child = join(directory, name, 'task.md')
      return existsSync(child) && taskStatus(child) !== 'completed'
    })
    .sort()
  if (unfinished.length === 0) return []
  return [
    diagnostic(
      `Task cannot be completed while subtasks are pending: ${unfinished.join(', ')}.`
    )
  ]
}

/** 读取 `task.md` 的 frontmatter status（缺失 / 解析失败返回 `undefined` ⇒ 视为未完成）。 */
function taskStatus(file: string): unknown {
  try {
    return matter(readFileSync(file, 'utf8')).data.status
  } catch {
    return undefined
  }
}
