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

const electronMocks = vi.hoisted(() => ({
  userDataPath: '',
  openExternal: vi.fn()
}))

const mockAuth = vi.hoisted(() => vi.fn(async () => 'AUTHORIZED' as const))
const mockWaitForCode = vi.hoisted(() =>
  vi.fn(async () => ({ code: 'code-x', state: 'state-s', iss: 'https://iss' }))
)
const MockUnauthorizedError = vi.hoisted(
  () =>
    class UnauthorizedError extends Error {
      constructor() {
        super('Unauthorized')
      }
    }
)

vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: mockCreateMCPClient,
  auth: mockAuth,
  UnauthorizedError: MockUnauthorizedError
}))
vi.mock('@ai-sdk/mcp/mcp-stdio', () => ({
  Experimental_StdioMCPTransport: MockStdioTransport
}))
vi.mock('../../../../src/main/auth/mcp-oauth-callback', () => ({
  waitForMcpAuthorizationCode: mockWaitForCode
}))
vi.mock('electron', () => ({
  app: { getPath: () => electronMocks.userDataPath },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => {
      const decoded = value.toString()
      if (!decoded.startsWith('encrypted:')) throw new Error('invalid ciphertext')
      return decoded.slice('encrypted:'.length)
    }
  },
  net: { fetch: vi.fn() },
  shell: { openExternal: electronMocks.openExternal }
}))

import { connectMcp } from '../../../../src/main/core/plugin/mcp'
import type { PluginContext } from '../../../../src/main/core/plugin/protocol'

function makeCtx(): {
  ctx: PluginContext
  registered: Array<{ name: string; tool: Record<string, unknown> }>
  subscriptions: Array<{ dispose: () => void }>
} {
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
  mockAuth.mockClear()
  mockWaitForCode.mockClear()
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

  it('http: attaches the authProvider so OAuth is auto-detected on 401', async () => {
    const { ctx, registered } = makeCtx()
    const spec = { type: 'http' as const, url: 'https://mcp.example.com', headers: { x: '1' } }

    await connectMcp(ctx as unknown as PluginContext, { web: spec })

    const cfg = mockCreateMCPClient.mock.calls[0]![0] as {
      transport: { authProvider?: unknown; fetch?: unknown; url: string; headers?: unknown }
    }
    expect(cfg.transport.url).toBe('https://mcp.example.com')
    expect(cfg.transport.headers).toEqual({ x: '1' })
    expect(cfg.transport.authProvider).toBeDefined()
    expect(cfg.transport.fetch).toBeDefined()
    // Public server: no OAuth was triggered.
    expect(mockAuth).not.toHaveBeenCalled()

    expect(registered.map((r) => r.name)).toEqual(['search', 'fetch'])
  })

  it('sse: attaches the authProvider as well', async () => {
    const { ctx, registered } = makeCtx()
    const spec = { type: 'sse' as const, url: 'https://mcp.example.com/sse' }

    await connectMcp(ctx as unknown as PluginContext, { legacy: spec })

    const cfg = mockCreateMCPClient.mock.calls[0]![0] as {
      transport: { authProvider?: unknown; url: string }
    }
    expect(cfg.transport.url).toBe('https://mcp.example.com/sse')
    expect(cfg.transport.authProvider).toBeDefined()
    expect(registered.map((r) => r.name)).toEqual(['search', 'fetch'])
  })

  it('multi server: prefixes each tool with its serverName', async () => {
    const { ctx, registered } = makeCtx()
    const gh = { command: 'npx', args: ['-y', 'gh'] }
    const fetchCfg = { type: 'http' as const, url: 'https://f.example.com' }

    await connectMcp(ctx as unknown as PluginContext, { gh, fetch: fetchCfg })

    expect(registered.map((r) => r.name)).toEqual([
      'gh_search',
      'gh_fetch',
      'fetch_search',
      'fetch_fetch'
    ])
  })

  it('empty config: registers nothing, does not throw', async () => {
    const { ctx, registered } = makeCtx()

    await expect(connectMcp(ctx as unknown as PluginContext, {})).resolves.toBeUndefined()

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

  it('401 triggers OAuth: captures the loopback code, exchanges, then reconnects', async () => {
    const { ctx } = makeCtx()
    const spec = { type: 'http' as const, url: 'https://mcp.example.com' }

    // First connect is rejected by the transport because the server needs OAuth;
    // after the auth exchange the retry succeeds.
    mockCreateMCPClient
      .mockRejectedValueOnce(new MockUnauthorizedError())
      .mockResolvedValueOnce(mockClient)

    await connectMcp(ctx as unknown as PluginContext, { web: spec })

    // The transport's 401 surfaced UnauthorizedError; we captured the loopback
    // callback and exchanged the code via auth().
    expect(mockWaitForCode).toHaveBeenCalledOnce()
    const exchange = mockAuth.mock.calls.at(-1)![1] as {
      authorizationCode: string
      callbackState: string
      callbackIssuer: string
      serverUrl: string
    }
    expect(exchange.authorizationCode).toBe('code-x')
    expect(exchange.callbackState).toBe('state-s')
    expect(exchange.callbackIssuer).toBe('https://iss')
    expect(exchange.serverUrl).toBe('https://mcp.example.com')

    // The client is retried after auth and connects successfully.
    expect(mockCreateMCPClient).toHaveBeenCalledTimes(2)
    expect(ctx.registerTool).toHaveBeenCalled()
  })
})
