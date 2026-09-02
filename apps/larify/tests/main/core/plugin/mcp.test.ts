import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// SDK 模块在 import 时即被加载，用 vi.hoisted 把 mock 提到最前，
// 避免 vi.mock 工厂闭包引用到尚未声明的变量（TDZ）。
const { mockCreateMCPClient, mockClient, MockStdioTransport } = vi.hoisted(() => {
  const client = {
    tools: vi.fn(),
    close: vi.fn()
  }
  const createMCPClient = vi.fn(async () => client)
  class StdioTransport {
    server: unknown
    constructor(server: unknown) {
      this.server = server
    }
  }
  return {
    mockCreateMCPClient: createMCPClient,
    mockClient: client,
    MockStdioTransport: StdioTransport
  }
})

vi.mock('@ai-sdk/mcp', () => ({ createMCPClient: mockCreateMCPClient }))
vi.mock('@ai-sdk/mcp/mcp-stdio', () => ({
  Experimental_StdioMCPTransport: MockStdioTransport
}))

import { connectMcp } from '../../../../src/main/core/plugin/mcp'
import type { PluginContext } from '../../../../src/main/core/plugin/protocol'

function makeCtx() {
  const registered: Array<{ name: string; tool: Record<string, unknown> }> = []
  const subscriptions: Array<{ dispose: () => void }> = []
  const ctx = {
    manifest: {} as PluginContext['manifest'],
    registry: {} as PluginContext['registry'],
    subscriptions,
    registerTool: vi.fn((name: string, tool: Record<string, unknown>) => {
      registered.push({ name, tool })
    })
  }
  return { ctx, registered, subscriptions }
}

const toolSet = {
  search: {
    description: 'search',
    inputSchema: z.object({ q: z.string() }),
    execute: vi.fn()
  },
  fetch: {
    description: 'fetch',
    inputSchema: z.object({ url: z.string() }),
    execute: vi.fn()
  }
}

beforeEach(() => {
  mockCreateMCPClient.mockClear()
  mockClient.tools.mockReset()
  mockClient.close.mockReset()
  mockClient.tools.mockResolvedValue(toolSet)
})

describe('connectMcp', () => {
  it('stdio: spawns transport from spec, registers tools as-is, pushes dispose', async () => {
    const { ctx, registered, subscriptions } = makeCtx()
    const spec = { command: 'npx', args: ['-y', 'gh'], cwd: '/tmp' }

    await connectMcp(ctx as unknown as PluginContext, { gh: spec })

    // transport 是 StdioMCPTransport 实例，且以完整 spec 构造
    const cfg = mockCreateMCPClient.mock.calls[0]![0] as { transport: { server: unknown } }
    expect(cfg.transport.server).toEqual(spec)

    // 单 server：不带 serverName 中段
    expect(ctx.registerTool).toHaveBeenCalledTimes(2)
    expect(registered.map((r) => r.name)).toEqual(['search', 'fetch'])

    // 工具原样透传：不注入 metadata，故默认非 eager（按需发现）
    expect(registered[0]!.tool).toBe(toolSet.search)
    expect(registered[1]!.tool).toBe(toolSet.fetch)
    for (const r of registered) {
      expect((r.tool.metadata as { eager?: boolean } | undefined)?.eager).not.toBe(true)
    }

    // 关停时杀子进程 / 关连接
    expect(subscriptions).toHaveLength(1)
    subscriptions[0]!.dispose()
    expect(mockClient.close).toHaveBeenCalledOnce()
  })

  it('http: passes spec straight through as transport (no wrapper)', async () => {
    const { ctx, registered } = makeCtx()
    const spec = { type: 'http' as const, url: 'https://mcp.example.com', headers: { x: '1' } }

    await connectMcp(ctx as unknown as PluginContext, { web: spec })

    const cfg = mockCreateMCPClient.mock.calls[0]![0] as { transport: unknown }
    expect(cfg.transport).toEqual(spec)

    expect(registered.map((r) => r.name)).toEqual(['search', 'fetch'])
  })

  it('sse: passes spec straight through as transport (deprecated but still in SDK union)', async () => {
    const { ctx, registered } = makeCtx()
    const spec = { type: 'sse' as const, url: 'https://mcp.example.com/sse' }

    await connectMcp(ctx as unknown as PluginContext, { legacy: spec })

    const cfg = mockCreateMCPClient.mock.calls[0]![0] as { transport: unknown }
    expect(cfg.transport).toEqual(spec)
    expect(registered.map((r) => r.name)).toEqual(['search', 'fetch'])
  })

  it('multi server: prefixes each tool with its serverName', async () => {
    const { ctx, registered } = makeCtx()
    const gh = { command: 'npx', args: ['-y', 'gh'] }
    const fetchCfg = { type: 'http' as const, url: 'https://f.example.com' }

    await connectMcp(ctx as unknown as PluginContext, { gh, fetch: fetchCfg })

    expect(registered.map((r) => r.name)).toEqual([
      'gh_search', 'gh_fetch',
      'fetch_search', 'fetch_fetch'
    ])
  })

  it('empty config: registers nothing, does not throw', async () => {
    const { ctx, registered } = makeCtx()

    await expect(
      connectMcp(ctx as unknown as PluginContext, {})
    ).resolves.toBeUndefined()

    expect(ctx.registerTool).not.toHaveBeenCalled()
    expect(registered).toHaveLength(0)
  })

  it('isolates a single server failure: does not throw, registers nothing', async () => {
    const { ctx, registered } = makeCtx()
    mockCreateMCPClient.mockRejectedValueOnce(new Error('connection refused'))

    await expect(
      connectMcp(ctx as unknown as PluginContext, { bad: { command: 'nope' } })
    ).resolves.toBeUndefined()

    expect(ctx.registerTool).not.toHaveBeenCalled()
    expect(registered).toHaveLength(0)
  })
})
