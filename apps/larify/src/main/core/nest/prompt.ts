import { Liquid } from 'liquidjs'
import { larifyPath } from '../../utils/app-paths'
import template from './prompt.md?raw'

const liquid = new Liquid()

/**
 * 只统一**分隔符**（模型可能给正斜杠路径，`larifyPath` 在 Windows 用反斜杠）。
 * **不做大小写折叠**：Windows 不敏感，但 Linux 敏感——若折叠，`/home/Alice/...` 与
 * `/home/alice/...` 会被误判为同一个 tasks 根，导致子任务被当成根任务（不注入父路径）、
 * 多层嵌套失效。同时注入给模型的父路径也保持原样，不与实际文件系统路径产生大小写差异。
 */
function normalize(value: string): string {
  return value.replaceAll('\\', '/')
}

/**
 * 取父目录（纯字符串处理，不依赖 `node:path` 的平台分隔符语义）。
 * 剥两层：先去掉文件名 `task.md`，再去掉任务目录本身 —— `tasks/A/B/task.md` → `tasks/A`。
 */
function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf('/', path.lastIndexOf('/') - 1))
}

/**
 * 按任务目录结构推导**父任务**的 task.md 路径：
 * `<tasks>/A/task.md` → `undefined`（根任务）；`<tasks>/A/B/task.md` → `<tasks>/A/task.md`。
 * 任务树是单链，父子关系**由目录结构唯一确定**，故无需模型在 task.md 里自行声明（也就不会写错）。
 */
export function parentTaskFile(taskFile: string): string | undefined {
  const parent = parentDirectory(normalize(taskFile))
  return parent === normalize(larifyPath('tasks')) ? undefined : `${parent}/task.md`
}

/**
 * 渲染 nest 判据：**只告诉模型"现在该完成哪个 task.md"**。
 *
 * "如何完成任务"（三阶段 Workflow）统一写在系统提示词 `agent/prompt.md`，不在判据里重复——
 * 避免两处指令不一致。这里只注入 `taskFile` 与 `parentClause`：
 * - 根任务（无父）：`parentClause` 为空串，句子自然结束于「……set status to `in_progress`」。
 * - 子任务：追加「完成后调度父任务」的收尾从句，并给出**确定的父 task.md 路径**——
 *   使「回父」是一个确定的路径，而不是让模型猜（曾经靠猜，猜成自己 → 无限重入）。
 */
export function buildNestPrompt(
  taskFile: string,
  /** 父 task.md 路径；缺省按目录结构推导。传 `null` 可显式表示"无父"。 */
  parentTask: string | null | undefined = parentTaskFile(taskFile)
): string {
  return liquid
    .parseAndRenderSync(template, {
      taskFile,
      parentClause: parentTask
        ? `, finally call \`agent_schedule_task\` only once with the parent task.md path \`${parentTask}\` to set status to \`in_progress\``
        : ''
    })
    .trim()
}
