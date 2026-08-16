import type { ComponentType, ReactNode } from 'react'
import type { Disposable } from '@shared/infra/disposable'
import { defineService, type Registry } from '@shared/infra/registry'

export interface WorkbenchRendererProps {
  active?: boolean
  cwd: string
  resourceId: number
  sessionId: string
  updateTab(tab: Partial<WorkbenchTabPresentation>): void
}

export interface WorkbenchTabPresentation {
  icon: ReactNode
  title: string
}

export interface WorkbenchRendererDefinition {
  bindTab?(props: WorkbenchRendererProps): Disposable
  component: ComponentType<WorkbenchRendererProps>
  icon: ReactNode
  order: number
  title: string
}

export const workbenchRendererRegistryToken = defineService()

export class WorkbenchRendererRegistry {
  private readonly renderers = new Map<string, WorkbenchRendererDefinition>()

  constructor(private readonly registry: Registry) {}

  register(id: string, renderer: WorkbenchRendererDefinition): Disposable {
    if (this.renderers.has(id)) throw new Error(`Workbench renderer "${id}" is already registered.`)
    this.renderers.set(id, renderer)
    this.registry.emit(workbenchRendererRegistryToken)
    return {
      dispose: () => {
        if (this.renderers.get(id) !== renderer) return
        this.renderers.delete(id)
        this.registry.emit(workbenchRendererRegistryToken)
      }
    }
  }

  get(id: string): WorkbenchRendererDefinition | undefined {
    return this.renderers.get(id)
  }

  list(): Array<[string, WorkbenchRendererDefinition]> {
    return [...this.renderers].sort(
      ([firstId, first], [secondId, second]) =>
        first.order - second.order || firstId.localeCompare(secondId)
    )
  }
}
