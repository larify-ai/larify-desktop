import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { larifyPath } from '../../utils/app-paths'
import type { Plugin } from './protocol'
import { connectMcp, type MCPServerConfig } from './mcp'

export interface DiscoveredPlugin {
  fingerprint: string
  plugin: Plugin
}

export class FilesystemPluginDiscovery {
  discover(): DiscoveredPlugin[] {
    const root = larifyPath('plugins')
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return []
      const file = join(root, entry.name, 'plugin.json')
      if (!existsSync(file)) return []
      try {
        const { mtimeMs, size } = statSync(file)
        return [{
          fingerprint: `${mtimeMs}:${size}`,
          plugin: declarativePlugin(entry.name, JSON.parse(readFileSync(file, 'utf8')))
        }]
      } catch (error) {
        console.error(`[plugin-discovery] Failed to load plugin "${entry.name}":`, error)
        return []
      }
    })
  }
}

export const pluginDiscovery = new FilesystemPluginDiscovery()

function declarativePlugin(id: string, spec: Record<string, unknown>): Plugin {
  return {
    manifest: {
      id,
      version: typeof spec.version === 'string' ? spec.version : '0.0.0',
      description: typeof spec.description === 'string' ? spec.description : undefined
    },
    activate(ctx) {
      const servers = spec.mcpServers as Record<string, MCPServerConfig> | undefined
      if (!servers) return
      void connectMcp(ctx, servers)
    }
  }
}
