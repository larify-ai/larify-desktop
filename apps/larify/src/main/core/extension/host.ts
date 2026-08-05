import type { App, Extension } from '../../../shared/extension'
import type { Service } from '../../../shared/extension/service'
import type { Skill } from '../../../shared/extension/skill'
import type { Tool } from '../../../shared/extension/tool'
import type { View } from '../../../shared/extension/view'
import { toolName, wrapTool } from './tool'

interface RegisteredExtension {
  extension: Extension
  tools: Map<string, Tool>
  skills: Map<string, Skill>
  views: Map<string, View<unknown>>
  services: Map<Service<unknown>, unknown>
}

export class ExtensionHost {
  private readonly extensions = new Map<string, RegisteredExtension>()

  has(name: string): boolean {
    return this.extensions.has(name)
  }

  async activate(extension: Extension): Promise<void> {
    if (this.extensions.has(extension.name))
      throw new Error(`Extension already registered: ${extension.name}`)

    const registered: RegisteredExtension = {
      extension,
      tools: new Map(),
      skills: new Map(),
      views: new Map(),
      services: new Map()
    }
    this.extensions.set(extension.name, registered)

    try {
      await extension.activate(this.createApp(registered))
    } catch (error) {
      this.extensions.delete(extension.name)
      throw error
    }
  }

  async deactivate(name: string): Promise<void> {
    const registered = this.extensions.get(name)
    if (!registered) return

    this.extensions.delete(name)
    await registered.extension.deactivate?.()
  }

  getTool(extension: string, name: string): Tool | undefined {
    return this.extensions.get(extension)?.tools.get(name)
  }

  getTools(): Map<string, Tool> {
    return new Map(
      [...this.extensions.entries()].flatMap(([plugin, { tools }]) =>
        [...tools].map(([name, tool]) => [toolName(plugin, name), tool] as const)
      )
    )
  }

  listPlugins(): Array<
    Pick<Extension, 'name' | 'description'> & { tools: number; skills: number }
  > {
    return [...this.extensions.values()]
      .filter(({ tools, skills }) => tools.size > 0 || skills.size > 0)
      .map(({ extension, tools, skills }) => ({
        name: extension.name,
        description: extension.description,
        tools: tools.size,
        skills: skills.size
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  listTools(
    extension: string,
    eager?: boolean
  ): Array<{ name: string; description?: string }> | undefined {
    const registered = this.extensions.get(extension)
    if (!registered) return undefined
    return [...registered.tools.entries()]
      .filter(([, tool]) => eager === undefined || (tool.metadata?.eager === true) === eager)
      .map(([name, tool]) => ({
        name: toolName(extension, name),
        ...(typeof tool.description === 'string' ? { description: tool.description } : {})
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  listSkills(
    extension: string,
    eager?: boolean
  ): Array<{ path: string; description: string }> | undefined {
    const registered = this.extensions.get(extension)
    if (!registered) return undefined
    return [...registered.skills.entries()]
      .filter(([, skill]) => eager === undefined || (skill.metadata?.eager === true) === eager)
      .map(([, skill]) => ({
        path: skill.path,
        description: skill.description
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  eagerSkills(): Array<{ path: string; description: string }> {
    return [...this.extensions.keys()].flatMap((name) => this.listSkills(name, true) ?? [])
  }

  getSkill(extension: string, name: string): Skill | undefined {
    return this.extensions.get(extension)?.skills.get(name)
  }

  getView(extension: string, name: string): View<unknown> | undefined {
    return this.extensions.get(extension)?.views.get(name)
  }

  getService<T>(service: Service<T>): T | undefined {
    for (const extension of this.extensions.values()) {
      if (extension.services.has(service)) return extension.services.get(service) as T
    }
    return undefined
  }

  private createApp(registered: RegisteredExtension): App {
    return {
      registerTool: (name, tool) => {
        try {
          registered.tools.set(name, wrapTool(tool))
        } catch (error) {
          console.warn(
            `[agent tools] Skipped invalid tool "${toolName(registered.extension.name, name)}": ${error instanceof Error ? error.message : String(error)}`
          )
        }
      },
      registerSkill: (name, skill) => {
        registered.skills.set(name, skill)
      },
      registerView: (name, view) => {
        registered.views.set(name, view as View<unknown>)
      },
      registerService: (name, service) => {
        registered.services.set(name, service)
      },
      getService: (service) => this.getService(service)
    }
  }
}
