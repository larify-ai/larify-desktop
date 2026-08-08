import { serialize, deserialize } from 'node:v8'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { isLoopFinished, type UIMessage } from 'ai'
import { afterAll, describe, expect, it } from 'vitest'
import { runAgentSession, toolsContextFor } from '../../../../src/main/core/agent'
import { asDiffMeta, toolIcon } from '../../../../src/extensions/assistant/renderer/lib/diff-meta'
import { editFileTool } from '../../../../src/extensions/fs/main/edit'
import { readFileTool } from '../../../../src/extensions/fs/main/read'
import { callTool, freshSession } from '../../fs/main/harness'

const root = mkdtempSync(join(tmpdir(), 'larify-tool-context-'))
afterAll(() => rmSync(root, { force: true, recursive: true }))

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

function twoStepModel(toolCall: {
  toolCallId: string
  toolName: string
  input: string
}): MockLanguageModelV4 {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1
      if (call === 1) {
        return {
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', ...toolCall },
            { type: 'finish', finishReason: 'tool-calls', usage }
          ])
        }
      }
      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: '0' },
          { type: 'text-delta', id: '0', delta: 'done' },
          { type: 'text-end', id: '0' },
          { type: 'finish', finishReason: 'stop', usage }
        ])
      }
    }
  })
}

const toolPartOf = (message: UIMessage): { output?: unknown; toolMetadata?: unknown } =>
  message.parts.find(
    (p) => (p as { type?: string }).type?.startsWith('tool-') && 'output' in (p as object)
  ) as { output?: unknown; toolMetadata?: unknown }

const outputOf = (message: UIMessage): unknown => toolPartOf(message).output

describe('toolsContextFor 把一份会话上下文铺给每个工具', () => {
  it('每个工具名都映射到同一份上下文', () => {
    const context = { sessionId: 's', cwd: '/c' }
    const map = toolsContextFor({ edit: editFileTool, read: readFileTool } as never, context)

    expect(Object.keys(map).sort()).toEqual(['edit', 'read'])
    expect(map.edit).toBe(context)
    expect(map.read).toBe(context)
  })

  it('没有工具时给出空映射', () => {
    expect(toolsContextFor({} as never, { sessionId: 's', cwd: '/c' })).toEqual({})
  })
})

describe('经过 agent 的工具调用拿得到会话上下文', () => {
  it('edit 在 agent loop 里真正执行, 而不是因 context undefined 报错', async () => {
    const session = freshSession()
    const file = join(root, 'target.ts')
    writeFileSync(file, 'const a = 1\nconst b = 2\nconst c = 3\n')
    await callTool(readFileTool, { file_path: file }, { sessionId: session, cwd: root })

    const run = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'edit it' }] }],
      {
        tools: { edit: editFileTool } as never,
        activeTools: [],
        toolsContext: toolsContextFor({ edit: editFileTool } as never, {
          sessionId: session,
          cwd: root
        }),
        model: twoStepModel({
          toolCallId: 'call-1',
          toolName: 'edit',
          input: JSON.stringify({
            file_path: file,
            old_string: 'const b = 2',
            new_string: 'const b = 20'
          })
        }),
        stopWhen: isLoopFinished()
      }
    )

    const message = run.at(-1)!
    const output = outputOf(message) as { kind?: string; errorText?: string } | undefined

    expect(output, '工具应当产出结果而不是 undefined').toBeTruthy()
    expect((output as { kind?: string }).kind).toBe('diff')
    expect(readFileSync(file, 'utf8')).toContain('const b = 20')
  }, 30_000)

  it('工具输出经过 IPC 结构化克隆后仍是完整的 diff 元数据', async () => {
    const session = freshSession()
    const file = join(root, 'clone.ts')
    writeFileSync(file, 'line one\nline two\nline three\n')
    await callTool(readFileTool, { file_path: file }, { sessionId: session, cwd: root })

    const run = await runAgentSession(
      [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'edit it' }] }],
      {
        tools: { edit: editFileTool } as never,
        activeTools: [],
        toolsContext: toolsContextFor({ edit: editFileTool } as never, {
          sessionId: session,
          cwd: root
        }),
        model: twoStepModel({
          toolCallId: 'call-2',
          toolName: 'edit',
          input: JSON.stringify({ file_path: file, old_string: 'line two', new_string: 'LINE TWO' })
        }),
        stopWhen: isLoopFinished()
      }
    )

    const message = run.at(-1)!
    const part = deserialize(serialize(toolPartOf(message))) as {
      output?: unknown
      toolMetadata?: unknown
    }
    const cloned = part.output as { kind?: string; patch?: string }

    expect(cloned.kind).toBe('diff')
    expect(cloned.patch).toContain('-line two')
    expect(cloned.patch).toContain('+LINE TWO')

    expect(asDiffMeta(part.output), '渲染层应能从 part.output 认出 diff').toBe(part.output)
    expect(toolIcon(part.toolMetadata), '渲染层应能从 part.toolMetadata 取到图标').toBe('edit')
  }, 30_000)
})
