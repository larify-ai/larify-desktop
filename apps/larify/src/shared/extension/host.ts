import type { App, Extension } from '.'
import type { Service } from './service'
import type { Skill } from './skill'
import type { Tool } from './tool'
import type { View } from './view'

interface RegisteredExtension {
  extension: Extension
  tools: Map<string, Tool>
  skills: Map<string, Skill>
  views: Map<string, View<unknown>>
  services: Map<Service<unknown>, unknown>
}

export class ExtensionHost {
  private readonly extensions = new Map<string, RegisteredExtension>()

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
      registerTool: (name, tool) => registered.tools.set(name, tool),
      registerSkill: (name, skill) => registered.skills.set(name, skill),
      registerView: (name, view) => registered.views.set(name, view as View<unknown>),
      registerService: (name, service) => registered.services.set(name, service)
    }
  }
}
