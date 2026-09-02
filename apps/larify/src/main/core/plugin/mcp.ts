import { createMCPClient, type MCPClientConfig } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport, type StdioConfig } from '@ai-sdk/mcp/mcp-stdio'
import type { PluginContext } from './protocol'

export type MCPServerConfig = StdioConfig | MCPClientConfig['transport']

export async function connectMcp(
  ctx: PluginContext,
  servers: Record<string, MCPServerConfig>
): Promise<void> {
  const entries = Object.entries(servers)
  for (const [serverName, serverConfig] of entries) {
    const prefix = entries.length === 1 ? '' : `${serverName}_`
    try {
      const client = await createMCPClient({
        transport: 'command' in serverConfig ? new Experimental_StdioMCPTransport(serverConfig) : serverConfig,
        initializationOptions: { timeout: 30_000 }
      })
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
