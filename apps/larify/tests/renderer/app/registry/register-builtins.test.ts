// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { registerBuiltinRenderers } from '../../../../src/renderer/src/app/registry/register-builtins'
import { rendererPluginHostToken } from '../../../../src/renderer/src/app/registry/renderer-plugins'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'

describe('registerBuiltinRenderers', () => {
  it('registers the builtin renderers with their default presentation', () => {
    const registry = new Registry()
    registerBuiltinRenderers(registry)
    const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)

    expect(renderers).toBeInstanceOf(WorkbenchRendererRegistry)
    expect(renderers?.get('workspace')).toMatchObject({ order: 10, title: '文件' })
    expect(renderers?.get('changes')).toMatchObject({ order: 20, title: '变更' })
    expect(renderers?.get('terminal')).toMatchObject({ order: 30, title: '终端' })
    expect(renderers?.get('browser')).toMatchObject({ order: 40, title: '浏览器' })
    expect(renderers?.list().map(([id]) => id)).toEqual([
      'workspace',
      'changes',
      'terminal',
      'browser'
    ])
    expect(renderers?.get('terminal')?.icon).toMatchObject({
      props: { 'aria-hidden': true }
    })
  })

  it('makes the renderer registry available before announcing its contents', () => {
    const registry = new Registry()
    const listener = vi.fn(() => registry.get(workbenchRendererRegistryToken))
    registry.subscribe(workbenchRendererRegistryToken, listener)

    registerBuiltinRenderers(registry)

    expect(listener).toHaveReturnedWith(expect.any(WorkbenchRendererRegistry))
  })

  it('rejects repeated builtin registration without replacing the original registry', () => {
    const registry = new Registry()
    registerBuiltinRenderers(registry)
    const original = registry.get(workbenchRendererRegistryToken)

    expect(() => registerBuiltinRenderers(registry)).toThrow('Service is already registered.')
    expect(registry.get(workbenchRendererRegistryToken)).toBe(original)
  })

  it('unregisters plugin renderers when the plugin host is disposed', async () => {
    const registry = new Registry()
    registerBuiltinRenderers(registry)
    const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)

    await registry.dispose(rendererPluginHostToken)

    expect(renderers?.get('terminal')).toBeUndefined()
  })
})
