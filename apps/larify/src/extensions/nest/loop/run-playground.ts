import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, isAbsolute } from 'node:path'
import type { App } from '@shared/extension'
import type { UIMessageChunk } from 'ai'
import iconv from 'iconv-lite'
import { defaultModelConfig } from '../../../main/core/model/config'
import { larifyPath } from '../../../main/utils/app-paths'
import { runLoop } from './loop'

const MAX_LOG_LENGTH = 100
const MAX_ERROR_LENGTH = 500
const consoleEncoding = (() => {
  if (process.platform !== 'win32') return 'utf8'
  const codePage = /\d+/.exec(execFileSync('chcp.com').toString())?.[0]
  const encoding = `cp${codePage}`
  return iconv.encodingExists(encoding) ? encoding : 'utf8'
})()

function print(line: string): void {
  process.stderr.write(iconv.encode(`${line}\n`, consoleEncoding))
}

function append(current: string, delta: string): string {
  return (current + delta).slice(0, MAX_LOG_LENGTH + 1)
}

function display(value: unknown, limit = MAX_LOG_LENGTH): string {
  const text = (typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)))
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function createPrinter(): (chunk: UIMessageChunk) => void {
  const tools = new Map<string, string>()
  let reasoning = ''
  let text = ''
  return (chunk) => {
    switch (chunk.type) {
      case 'reasoning-start':
        reasoning = ''
        break
      case 'reasoning-delta':
        reasoning = append(reasoning, chunk.delta)
        break
      case 'reasoning-end':
        print(`[thinking] ${display(reasoning)}`)
        break
      case 'text-start':
        text = ''
        break
      case 'text-delta':
        text = append(text, chunk.delta)
        break
      case 'text-end':
        print(`[assistant] ${display(text)}`)
        break
      case 'tool-input-available': {
        const name = chunk.title ?? chunk.toolName
        tools.set(chunk.toolCallId, name)
        print(`[tool] ${name} ${display(chunk.input)}`)
        break
      }
      case 'tool-output-available':
        print(
          `[result] ${tools.get(chunk.toolCallId) ?? chunk.toolCallId} ${display(chunk.output)}`
        )
        break
      case 'tool-input-error':
        print(`[tool error] ${chunk.toolName} ${display(chunk.errorText, MAX_ERROR_LENGTH)}`)
        break
      case 'tool-output-error':
        print(
          `[tool error] ${tools.get(chunk.toolCallId) ?? chunk.toolCallId} ${display(chunk.errorText, MAX_ERROR_LENGTH)}`
        )
        break
      case 'tool-output-denied':
        print(`[tool denied] ${tools.get(chunk.toolCallId) ?? chunk.toolCallId}`)
        break
      case 'error':
        print(`[error] ${display(chunk.errorText, MAX_ERROR_LENGTH)}`)
    }
  }
}

export async function runPlayground(app: App, taskFile: string): Promise<void> {
  if (!isAbsolute(taskFile)) throw new Error('The task.md path must be absolute.')
  if (!existsSync(taskFile)) throw new Error(`Task file does not exist: ${taskFile}`)

  const cwd = larifyPath('playground', basename(dirname(taskFile)))
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })

  const controller = new AbortController()
  const abort = (): void => controller.abort()
  const printers = new Map<string, ReturnType<typeof createPrinter>>()
  process.once('SIGINT', abort)

  print(`[nest] workspace ${cwd}`)
  try {
    await runLoop({
      app,
      cwd,
      rootTaskFile: taskFile,
      modelConfig: defaultModelConfig,
      signal: controller.signal,
      onChunk: (taskFile, chunk) => {
        let printer = printers.get(taskFile)
        if (!printer) {
          printer = createPrinter()
          printers.set(taskFile, printer)
        }
        printer(chunk)
      }
    })
  } finally {
    process.off('SIGINT', abort)
  }
}
