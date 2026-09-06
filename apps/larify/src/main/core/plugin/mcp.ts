import { net } from 'electron'
import {
  createMCPClient,
  type MCPClient,
  type MCPClientConfig,
  auth,
  UnauthorizedError
} from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport, type StdioConfig } from '@ai-sdk/mcp/mcp-stdio'
import { McpOAuthClientProvider } from '../../auth/mcp-oauth-provider'
import { waitForMcpAuthorizationCode } from '../../auth/mcp-oauth-callback'
import type { PluginContext } from './protocol'

type HttpTransportConfig = Extract<
  MCPClientConfig['transport'],
  { type: 'http' | 'sse'; url: string }
>

export type MCPServerConfig = StdioConfig | HttpTransportConfig

function isStdio(config: MCPServerConfig): config is StdioConfig {
  return 'command' in config
}

export async function connectMcp(
  ctx: PluginContext,
  servers: Record<string, MCPServerConfig>
): Promise<void> {
  const entries = Object.entries(servers)
  for (const [serverName, serverConfig] of entries) {
    const prefix = entries.length === 1 ? '' : `${serverName}_`
    try {
      const client = await connectServer(serverName, serverConfig)
      ctx.subscriptions.push({ dispose: () => client.close() })

      const toolSet = await client.tools()
      for (const [toolName, tool] of Object.entries(toolSet)) {
        ctx.registerTool(`${prefix}${toolName}`, tool)
      }
    } catch (error) {
      console.error(`[mcp] Failed to connect server "${serverName}":`, error)
    }
  }
}

async function connectServer(
  serverName: string,
  serverConfig: MCPServerConfig
): Promise<MCPClient> {
  if (isStdio(serverConfig)) {
    return createMCPClient({
      transport: new Experimental_StdioMCPTransport(serverConfig),
      initializationOptions: { timeout: 30_000 }
    })
  }

  const provider = new McpOAuthClientProvider({ serverId: serverName })
  const fetch = net.fetch as unknown as HttpTransportConfig['fetch']
  const fetchFn = net.fetch as unknown as OAuthFetch
  const makeClient = (): Promise<MCPClient> =>
    createMCPClient({
      // An authProvider is always attached. For a server that needs authorization
      // it responds 401, the transport runs auth() and opens the browser, then
      // throws UnauthorizedError; for a public server it is never invoked.
      transport: { ...serverConfig, authProvider: provider, fetch },
      initializationOptions: { timeout: 30_000 }
    })

  try {
    return await makeClient()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      // The browser was opened by the transport; capture the loopback callback,
      // exchange the code, then reconnect with the now-valid provider.
      const { code, state, iss } = await waitForMcpAuthorizationCode()
      await auth(provider, {
        serverUrl: serverConfig.url,
        authorizationCode: code,
        callbackState: state,
        callbackIssuer: iss,
        fetchFn
      })
      return makeClient()
    }
    throw error
  }
}

type OAuthFetch = NonNullable<Parameters<typeof auth>[1]['fetchFn']>
