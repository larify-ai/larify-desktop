// 端到端验证：用真实 AI SDK 的 processUIMessageStream 跑流式，
// 确认 part 对象引用是否稳定 + 实测 buildAssistantRenderItems 耗时。
// 注：processUIMessageStream 未从 ai 主入口导出；导入路径依赖 pnpm 版本目录，
// ai 升级后需同步更新（该测试是手动基准，遇红即提醒）。
import type { UIMessage, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  createStreamingUIMessageState,
  processUIMessageStream
} from '../../node_modules/.pnpm/ai@7.0.77_zod@4.4.3/node_modules/ai/src/ui/process-ui-message-stream'
import { buildAssistantRenderItems } from '../../src/renderer/src/app/interaction/assistant/message-render-items'

function buildChunks(toolCount: number): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [{ type: 'start' }]
  for (let i = 0; i < toolCount; i += 1) {
    // 一段中间文本
    const textId = `t-${i}`
    chunks.push({ type: 'text-start', id: textId })
    chunks.push({
      type: 'text-delta',
      id: textId,
      delta: `已处理第 ${i} 个文件，结构和依赖关系都看过了。`
    })
    chunks.push({ type: 'text-end', id: textId })
    // 一次工具调用
    const toolId = `c-${i}`
    chunks.push({
      type: 'tool-input-start',
      toolCallId: toolId,
      toolName: 'read_file',
      dynamic: true
    })
    chunks.push({
      type: 'tool-input-available',
      toolCallId: toolId,
      toolName: 'read_file',
      input: { toolCallTitle: `读取 file-${i}.ts` },
      dynamic: true
    })
    chunks.push({ type: 'tool-output-available', toolCallId: toolId, output: 'ok' })
  }
  chunks.push({ type: 'finish' })
  return chunks
}

function toStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[index])
      index += 1
    }
  })
}

describe('AI SDK 真实流式下的 part 引用稳定性', () => {
  it(
    '验证 part 引用稳定 + 实测耗时',
    { timeout: 180_000 },
    async () => {
      for (const toolCount of [100, 300, 600]) {
        const chunks = buildChunks(toolCount)
        let latest: UIMessage | undefined
        let messageSnapshots = 0
        // 记录每个 part 对象引用，用于检测是否被替换
        let partRefs: unknown[] = []
        let refsChanged = 0

        const state = createStreamingUIMessageState<UIMessage>({
          lastMessage: undefined,
          messageId: 'msg'
        })

        const started = process.hrtime.bigint()
        await processUIMessageStream({
          stream: toStream(chunks),
          runUpdateMessageJob: (job) =>
            job({
              state,
              write: () => {
                latest = state.message
                messageSnapshots += 1
                // 检测已有 part 的引用是否发生变化
                const refs = state.message.parts
                for (let i = 0; i < partRefs.length && i < refs.length; i += 1) {
                  if (partRefs[i] !== refs[i]) refsChanged += 1
                }
                partRefs = refs.slice()
                // 每次更新都跑一次渲染项构建 —— 这就是流式时每帧的真实开销
                buildAssistantRenderItems(state.message, true)
              }
            }),
          onError: () => {}
        }).pipeTo(new WritableStream())
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

        const parts = latest?.parts.length ?? 0
        console.log(
          `\n  toolCount=${toolCount} → parts=${parts}\n` +
            `    更新次数=${messageSnapshots}  总耗时=${elapsedMs.toFixed(0)}ms  ` +
            `单次=${(elapsedMs / Math.max(1, messageSnapshots)).toFixed(3)}ms\n` +
            `    已有 part 引用被替换次数=${refsChanged}  ${refsChanged === 0 ? '✓ 引用稳定' : '✗ 引用不稳定'}`
        )
        expect(refsChanged).toBe(0)
      }
    },
    180_000
  )
})
