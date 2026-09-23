import { readFileSync } from 'node:fs'
import type { UIMessage } from 'ai'
import { describe, it } from 'vitest'
import { estimateTokens } from '../../../../src/main/core/agent/token-estimate'
import { toModelMessages } from '../../../../src/main/core/agent/messages'
import { buildSystemPrompt } from '../../../../src/main/core/agent/prompt'

/**
 * 用真实库里的会话消息（我这次会话 d764fc88 与 55b61dbe）复算：
 * 守门 prepareStep 看到的 `messages` 到底有多大？
 * 关键：toModelMessages 只转 UI 消息；system 提示是单独字段。
 * 这里把 system 也拼进来估算（守门本身不算 system，但为对照打印）。
 */
describe('zzprobe guard real input size', () => {
  it('prints sizes for my two sessions', async () => {
    const bankPath = 'C:/Users/hylnb/.larify/tmp-session-probe.json'
    let data: Record<string, UIMessage[]>
    try {
      data = JSON.parse(readFileSync(bankPath, 'utf8'))
    } catch {
      console.log('no bank file, skip')
      return
    }
    const template = readFileSync('./src/main/core/agent/prompt.md', 'utf8')
    const system = buildSystemPrompt(template, 'D:/Workspace/larify-desktop', {
      plugins: [
        {
          name: 'agent',
          description:
            'List plugins, list tools, list skills, read schemas, search memory, ask user, show progress, reset context, and schedule tasks. (9 tools, 0 skills)'
        }
      ],
      skills: []
    })
    console.log('system chars =', system.length, 'est =', estimateTokens([{ role: 'user', content: system } as never]))
    for (const [sid, msgs] of Object.entries(data)) {
      const model = await toModelMessages(msgs)
      console.log(
        `session ${sid.slice(0, 8)}: uiMsgs=${msgs.length} modelMsgs=${model.length} est(model)=${estimateTokens(model)}`
      )
    }
  })
})
