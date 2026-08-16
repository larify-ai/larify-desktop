import agentPlugin from '../../../../extensions/agent/main'
import fsPlugin from '../../../../extensions/fs/main'
import terminalPlugin from '../../../../extensions/terminal/main'
import browserPlugin from '../../../../extensions/browser/main'
import workspacePlugin from '../../../../extensions/workspace/main'
import type { Plugin } from '../protocol'

export function discoverBuiltinPlugins(): Plugin[] {
  return [agentPlugin, fsPlugin, terminalPlugin, browserPlugin, workspacePlugin]
}
