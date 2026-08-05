import type { Tool } from './extension/tool'

/** @deprecated Migrate the extension to ExtensionHost. */
export interface Toolkit {
  name: string
  description?: string
  eager?: boolean
  instruction?: string
  tools: Record<string, Tool>
}
