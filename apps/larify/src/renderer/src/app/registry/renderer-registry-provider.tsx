import type { ReactNode } from 'react'
import type { Registry } from '@shared/infra/registry'
import { RendererRegistryContext } from './renderer-registry'

interface RendererRegistryProviderProps {
  children: ReactNode
  registry: Registry
}

export function RendererRegistryProvider({
  children,
  registry
}: RendererRegistryProviderProps): React.JSX.Element {
  return (
    <RendererRegistryContext.Provider value={registry}>{children}</RendererRegistryContext.Provider>
  )
}
