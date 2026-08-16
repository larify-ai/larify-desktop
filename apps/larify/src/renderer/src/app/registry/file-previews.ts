import type { ComponentType } from 'react'
import type { Disposable } from '@shared/infra/disposable'
import { defineService } from '@shared/infra/registry'

export interface PreviewFile {
  binary: boolean
  mime: string
  path: string
}

export interface PreviewRendererProps {
  active?: boolean
  animating?: boolean
  file: PreviewFile
  mode?: 'preview' | 'source'
  resourceId: number
  target?: { hash: string }
}

export interface PreviewRenderer {
  component: ComponentType<PreviewRendererProps>
  priority?: number
  supports(file: PreviewFile): boolean
}

export const previewRegistryToken = defineService()

export class PreviewRegistry {
  private readonly renderers = new Set<PreviewRenderer>()

  register(renderer: PreviewRenderer): Disposable {
    this.renderers.add(renderer)
    return {
      dispose: () => {
        this.renderers.delete(renderer)
      }
    }
  }

  find(file: PreviewFile): PreviewRenderer | undefined {
    return [...this.renderers]
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .find((renderer) => renderer.supports(file))
  }
}
