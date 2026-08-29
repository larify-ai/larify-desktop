// 量化 summarizeMessageChanges 的成本（流式消息每次更新都会调用）
import { describe, it } from 'vitest'
import type { UIMessage } from 'ai'
import { summarizeMessageChanges } from '../../src/renderer/src/app/interaction/assistant/change-summary'

const tool = (id: string): UIMessage['parts'][number] => ({
  type: 'dynamic-tool',
  toolName: 'read_file',
  toolCallId: id,
  state: 'output-available',
  input: { toolCallTitle: `读取 ${id}` },
  output: 'ok'
})
const text = (s: string): UIMessage['parts'][number] => ({ type: 'text', text: s })

function timeIt(label: string, iterations: number, fn: () => void): number {
  for (let i = 0; i < 3; i += 1) fn()
  const started = process.hrtime.bigint()
  for (let i = 0; i < iterations; i += 1) fn()
  const per = Number(process.hrtime.bigint() - started) / 1e6 / iterations
  console.log(`  ${label.padEnd(46)} ${per.toFixed(4)}ms`)
  return per
}

describe('summarizeMessageChanges 成本', () => {
  it('无 git-snapshot 时需遍历全部 parts', { timeout: 60_000 }, () => {
    console.log('\n=== 最坏情况：无 data-git-snapshot，遍历全部 parts ===')
    for (const count of [100, 500, 1000]) {
      const parts: UIMessage['parts'] = []
      for (let i = 0; i < count; i += 1) {
        parts.push(text(`处理第 ${i} 个文件`))
        parts.push(tool(`c-${i}`))
      }
      const msg: UIMessage = { id: 'm', role: 'assistant', parts }
      timeIt(`parts=${parts.length} (无 snapshot)`, 2000, () => {
        void summarizeMessageChanges(msg)
      })
    }
  })

  it('有 git-snapshot 时提前命中', { timeout: 60_000 }, () => {
    console.log('\n=== 有 data-git-snapshot（位于末尾，立即命中）===')
    for (const count of [100, 1000]) {
      const parts: UIMessage['parts'] = []
      for (let i = 0; i < count; i += 1) {
        parts.push(text(`处理第 ${i} 个文件`))
        parts.push(tool(`c-${i}`))
      }
      parts.push({
        type: 'data-git-snapshot',
        data: { files: [{ path: 'a.ts', additions: 1, deletions: 0, patch: 'x' }] }
      } as UIMessage['parts'][number])
      const msg: UIMessage = { id: 'm2', role: 'assistant', parts }
      timeIt(`parts=${parts.length} (末尾 snapshot)`, 2000, () => {
        void summarizeMessageChanges(msg)
      })
    }
  })
})
