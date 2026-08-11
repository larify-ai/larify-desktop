import { createContext, useContext } from 'react'
import type { Registry } from '@shared/infra/registry'

export const RendererRegistryContext = createContext<Registry | null>(null)

export function useRendererRegistry(): Registry {
  const registry = useContext(RendererRegistryContext)
  if (!registry) throw new Error('RendererRegistryProvider is missing.')
  return registry
}
