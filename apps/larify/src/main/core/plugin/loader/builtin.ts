import agentPlugin from '../../../../extensions/agent/main'
import type { Plugin } from '../protocol'

export function discoverBuiltinPlugins(): Plugin[] {
  return [agentPlugin]
}
