// 修复前后对比基准：textSummary 缓存
// 用 git stash 切换修复前后两次运行，对比同一场景
import { describe, it } from 'vitest'
import type { UIMessage } from 'ai'
import { buildAssistantRenderItems } from '../../src/renderer/src/app/interaction/assistant/message-render-items'

const tool = (id: string): UIMessage['parts'][number] => ({
  type: 'dynamic-tool',
  toolName: 'read_file',
  toolCallId: id,
  state: 'output-available',
  input: { toolCallTitle: `读取 ${id}` },
  output: 'ok'
})

// 无 state 的 text part（触发根因①：complete=false）
const bareText = (s: string): UIMessage['parts'][number] => ({ type: 'text', text: s })

function timeIt(label: string, iterations: number, fn: (i: number) => void): number {
  for (let i = 0; i < 3; i += 1) fn(i)
  const started = process.hrtime.bigint()
  for (let i = 0; i < iterations; i += 1) fn(i)
  const total = Number(process.hrtime.bigint() - started) / 1e6
  const per = total / iterations
  console.log(`  ${label.padEnd(34)} ${per.toFixed(3)}ms`)
  return per
}

describe('textSummary 修复对比', () => {
  it('场景1：无 state 的 text part（根因①）', { timeout: 120_000 }, () => {
    console.log('\n=== 场景1：text part 无 state，streaming=true ===')
    for (const count of [100, 300]) {
      const parts: UIMessage['parts'] = []
      for (let i = 0; i < count; i += 1) {
        parts.push(bareText(`已处理第 ${i} 个文件，结构和依赖关系都看过了`))
        parts.push(tool(`a-${i}`))
      }
      const per = timeIt(`count=${count}`, 15, () =>
        void buildAssistantRenderItems({ id: 'x', role: 'assistant', parts, metadata: {} }, true)
      )
      console.log(`     → @10Hz 占主线程 ${(per * 10).toFixed(0)}ms/s`)
    }
  })

  it('场景2：跨越原 500 缓存上限（根因②）', { timeout: 120_000 }, () => {
    console.log('\n=== 场景2：text part 数跨越 500（全部 state=done）===')
    for (const count of [200, 400, 600, 900]) {
      const parts: UIMessage['parts'] = []
      for (let i = 0; i < count; i += 1) {
        parts.push({
          type: 'text',
          text: `已处理第 ${i} 个文件。这里是较长的一段说明文字，用来确保长度超过摘要前缀限制从而稳定写入缓存。`.repeat(3),
          state: 'done'
        } as UIMessage['parts'][number])
        parts.push(tool(`c-${i}`))
      }
      const per = timeIt(`text parts=${count}`, 8, () =>
        void buildAssistantRenderItems({ id: `z-${count}`, role: 'assistant', parts, metadata: {} }, true)
      )
      console.log(`     → @10Hz 占主线程 ${(per * 10).toFixed(0)}ms/s`)
    }
  })

  it('场景3：真实流式（id 稳定，仅最后一个 part 增长）', { timeout: 120_000 }, () => {
    console.log('\n=== 场景3：真实流式，id 稳定 ===')
    for (const count of [100, 300, 600]) {
      const parts: UIMessage['parts'] = []
      for (let i = 0; i < count; i += 1) {
        parts.push(bareText(`已处理第 ${i} 个文件，结构和依赖关系都看过了，改动方案如下。`))
        parts.push(tool(`c-${i}`))
      }
      const streamingPart = bareText('正在总结：')
      parts.push(streamingPart)
      const msg: UIMessage = { id: 'live', role: 'assistant', parts, metadata: { startedAt: 1 } }
      let tick = 0
      const per = timeIt(`settled=${count * 2} + 1 streaming`, 30, () => {
        tick += 1
        ;(streamingPart as { text: string }).text = `正在总结：已完成 ${tick} 项，接下来处理剩余部分。${'x'.repeat(tick % 200)}`
        void buildAssistantRenderItems(msg, true)
      })
      console.log(`     → @10Hz 占主线程 ${(per * 10).toFixed(0)}ms/s`)
    }
  })
})
