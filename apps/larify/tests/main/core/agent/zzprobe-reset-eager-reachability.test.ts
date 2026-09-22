/**
 * 一次性动态探针（R37 复核）：用**真实 agent 扩展**挂载后，打印 `createAgentRuntime`
 * 算出的 `activeTools`，并交叉验证「模型实际收到的 tools」。
 *
 * 目的：确证 `reset-context.ts` 的 `metadata.eager` 取值与 `agent_reset_context`
 * 是否进入模型可见工具集之间的因果链：
 *   eager=true  ⇒ 在 activeTools ⇒ 模型可见/可调
 *   eager=false ⇒ 不在 activeTools ⇒ 模型请求工具集里被 `promptWithTools` 过滤掉 ⇒ 不可调
 *
 * 同时交叉验证 `agent_get_tool_schemas` **无激活副作用**：它只是读出 schema 文本，
 * 不改 `activeTools`（activeTools 只在 runtime 构造时算一次）。
 *
 * ⚠️ 仅调试用，不入正式测试集（含 console.log）。
 */
import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/main/model-api/service', () => ({
  getModelApiService: () => ({
    getCachedCredentialsSync: () => ({ baseUrl: 'https://api.larify.ai', apiKey: 'sk-test' })
  })
}))

import { runAgent } from '../../../../src/main/core/agent/engine'
import { createAgentRuntime } from '../../../../src/main/core/agent/runtime'
import { PluginHost, pluginHostToken } from '../../../../src/main/core/plugin'
import { Registry } from '../../../../src/shared/infra/registry'
import agentPlugin from '../../../../src/extensions/agent/main/index'

async function mountHost(): Promise<PluginHost> {
  const registry = new Registry()
  const host = new PluginHost(registry)
  registry.register(pluginHostToken, host)
  await host.activate(agentPlugin as never)
  return host
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}
function model(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: 'ok' },
        { type: 'text-end', id: 'text' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }
      ])
    })
  })
}

describe('R37 探针：reset_context eager 与可调用性', () => {
  it('真实 agent 扩展下：agent_reset_context 的 eager 取值的直接后果', async () => {
    const host = await mountHost()
    const runtime = createAgentRuntime({ sessionId: 'probe', cwd: 'cwd' }, host)

    console.log('[probe] all tools =', Object.keys(runtime.tools).sort())
    console.log('[probe] activeTools =', [...runtime.activeTools].sort())
    console.log(
      '[probe] reset in activeTools? =',
      runtime.activeTools.includes('agent_reset_context')
    )

    // 用真实 runAgent 抓「模型实际收到的 tools」
    const languageModel = model()
    const stream = runAgent([{ role: 'user', content: 'hi' }], {
      ...runtime,
      model: languageModel
    })
    for await (const _ of stream) void _
    const visible = (languageModel.doStreamCalls[0].tools ?? []).map(({ name }) => name).sort()
    console.log('[probe] tools visible to model =', visible)
    console.log('[probe] model can call reset_context? =', visible.includes('agent_reset_context'))

    // 事实断言（与当前工作区 eager:false 一致）：
    expect(runtime.activeTools.includes('agent_reset_context')).toBe(false)
    expect(visible.includes('agent_reset_context')).toBe(false)
    expect(visible.includes('agent_get_tool_schemas')).toBe(true)
  })

  it('agent_get_tool_schemas 只读 schema、无激活副作用（读它不会把 reset 变可调）', async () => {
    const host = await mountHost()
    const runtime = createAgentRuntime({ sessionId: 'probe2', cwd: 'cwd' }, host)
    const getSchemas = runtime.tools.agent_get_tool_schemas as {
      execute: (input: { tool_names: string[] }, ctx: unknown) => Promise<unknown>
    }
    const out = await getSchemas.execute(
      { tool_names: ['agent_reset_context'] },
      (runtime.toolsContext as Record<string, unknown>).agent_get_tool_schemas
    )
    console.log('[probe] get_tool_schemas(output) =', JSON.stringify(out))
    console.log('[probe] activeTools AFTER read =', [...runtime.activeTools].sort())
    // 读 schema 前后 activeTools 不变 ⇒ 无激活副作用
    expect(runtime.activeTools.includes('agent_reset_context')).toBe(false)
  })
})
