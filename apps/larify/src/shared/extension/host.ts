import type { App, Extension } from "."
import type { Service } from "./service"
import type { Skill } from "./skill"
import type { Tool } from "./tool"
import type { View } from "./view"

interface Entry<T> {
  value: T
  eager: boolean
}

interface RegisteredExtension {
  tools: Map<string, Entry<Tool>>
  skills: Map<string, Entry<Skill>>
  views: Map<string, View<unknown>>
  services: Map<Service<unknown>, unknown>
}

export class ExtensionHost {
  private readonly extensions = new Map<string, RegisteredExtension>()

  async register(extension: Extension): Promise<void> {
    if (this.extensions.has(extension.name)) throw new Error(`Extension already registered: ${extension.name}`)

    const registered: RegisteredExtension = {
      tools: new Map(),
      skills: new Map(),
      views: new Map(),
      services: new Map(),
    }
    this.extensions.set(extension.name, registered)

    try {
      await extension.activate(this.createApp(registered))
    } catch (error) {
      this.extensions.delete(extension.name)
      throw error
    }
  }

  unregister(name: string): void {
    this.extensions.delete(name)
  }

  getTool(extension: string, name: string): Tool | undefined {
    return this.extensions.get(extension)?.tools.get(name)?.value
  }

  getSkill(extension: string, name: string): Skill | undefined {
    return this.extensions.get(extension)?.skills.get(name)?.value
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
      registerTool: (name, tool, eager = false) => registered.tools.set(name, { value: tool, eager }),
      registerSkill: (name, skill, eager = false) => registered.skills.set(name, { value: skill, eager }),
      registerView: (name, view) => registered.views.set(name, view as View<unknown>),
      registerService: (name, service) => registered.services.set(name, service),
    }
  }
}
