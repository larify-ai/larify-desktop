import type { Tool, Toolkit } from "../../../shared/tool"

export class ToolRegistry {
  private readonly kits = new Map<string, Toolkit>()
  private readonly tools = new Map<string, Tool>()

  constructor(kits: Toolkit[]) {
    for (const kit of kits) {
      this.kits.set(kit.name, kit)
      for (const tool of kit.tools) this.tools.set(tool.name, tool)
    }
  }

  listKits() {
    return [...this.kits.values()].map((kit) => ({ name: kit.name, description: kit.description }))
  }

  listTools(name: string) {
    return this.kits.get(name)?.tools.map((tool) => ({ name: tool.name, description: tool.description }))
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }
}
