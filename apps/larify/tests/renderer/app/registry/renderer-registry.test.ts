// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { useRendererRegistry } from '../../../../src/renderer/src/app/registry/renderer-registry'
import { RendererRegistryProvider } from '../../../../src/renderer/src/app/registry/renderer-registry-provider'

describe('renderer registry context', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    vi.restoreAllMocks()
  })

  it('provides the registry instance', () => {
    const registry = new Registry()
    let received: Registry | undefined
    const Consumer = (): null => {
      received = useRendererRegistry()
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => {
      root.render(createElement(RendererRegistryProvider, { registry }, createElement(Consumer)))
    })

    expect(received).toBe(registry)
    act(() => root.unmount())
  })

  it('rejects use outside the provider', () => {
    const Consumer = (): null => {
      useRendererRegistry()
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => act(() => root.render(createElement(Consumer)))).toThrow(
      'RendererRegistryProvider is missing.'
    )
    act(() => root.unmount())
  })
})
