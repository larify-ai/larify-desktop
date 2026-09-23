/**
 * 一次性动态探针：确证「eager:false 的 agent_reset_context 为何仍被模型调用」的泄漏路径。
 *
 * 假设：模型看不到 `agent_reset_context` 工具本身（已被 promptWithTools 过滤），
 * 但 `agent_get_tool_schemas`（eager:true）的描述与**系统提示里 agent 插件的描述行**
 * 会让模型"知道有 reset context 这个东西"，于是它能用 get_tool_schemas 读 schema 再调用。
 *
 * 本探针打印：
 *   1. 真实 agent 扩展下的 activeTools（模型可见工具）
 *   2. runtime.system 里 agent 插件描述行（看是否明文含 "reset context"）
 *   3. agent_get_tool_schemas 能否读到 agent_reset_context 的 schema
 *
 * ⚠️ 仅调试用，不入正式测试集。
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

describe('探针：reset 通过系统提示泄漏', () => {
  it('系统提示里 agent 插件描述是否明文含 reset context', async () => {
    const host = await mountHost()
    const runtime = createAgentRuntime({ sessionId: 'probe', cwd: 'cwd' }, host)

    const lines = runtime.system.split('\n')
    const agentLine = lines.find((l) => l.includes('`agent`'))
    console.log('[probe] agent plugin line =', JSON.stringify(agentLine))
    console.log('[probe] system contains "reset context" =', runtime.system.includes('reset context'))
    console.log('[probe] system contains "agent_reset_context" =', runtime.system.includes('agent_reset_context'))

    // 模型实际收到的 tools
    const languageModel = model()
    const stream = runAgent([{ role: 'user', content: 'hi' }], { ...runtime, model: languageModel })
    for await (const _ of stream) void _
    const visible = (languageModel.doStreamCalls[0].tools ?? []).map(({ name }) => name).sort()
    console.log('[probe] tools visible to model =', visible)

    // get_tool_schemas 能否读到 reset 的 schema
    const getSchemas = runtime.tools.agent_get_tool_schemas as {
      execute: (i: { tool_names: string[] }, c: unknown) => Promise<unknown>
    }
    const out = await getSchemas.execute(
      { tool_names: ['agent_reset_context'] },
      (runtime.toolsContext as Record<string, unknown>).agent_get_tool_schemas
    )
    console.log('[probe] get_tool_schemas(reset) =', JSON.stringify(out))

    expect(runtime.system.includes('reset context')).toBe(true)
  })
})
