// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { RendererPluginHost } from '../../../../src/renderer/src/app/registry/renderer-plugins'
import {
  WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '../../../../src/renderer/src/app/registry/workbench-renderers'
import plugin from '../../../../src/extensions/terminal/renderer'

describe('terminal renderer registration', () => {
  let invoke: ReturnType<typeof vi.fn>
  let renderer: WorkbenchRendererRegistry

  beforeEach(() => {
    invoke = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      terminals: [{ id: 7, title: 'PowerShell' }]
    })
    Object.assign(window, { bridge: { invoke } })
    const registry = new Registry()
    renderer = new WorkbenchRendererRegistry(registry)
    registry.register(workbenchRendererRegistryToken, renderer)
    new RendererPluginHost(registry).activate(plugin)
  })

  it('registers its launcher metadata', () => {
    expect(renderer.get('terminal')).toMatchObject({ order: 30, title: '终端' })
    expect(renderer.get('terminal')?.icon).toMatchObject({
      props: { className: 'larify-workbench-icon-terminal' }
    })
  })

  it('loads the initial terminal title without mounting its component', async () => {
    const updateTab = vi.fn()
    renderer.get('terminal')?.bindTab?.({
      resourceId: 7,
      sessionId: 'session-1',
      updateTab
    })
    await vi.waitFor(() => expect(updateTab).toHaveBeenCalledWith({ title: 'PowerShell' }))
    expect(invoke).toHaveBeenCalledWith('terminal:getState', 'session-1')
  })

  it('does not update a tab after its binding is disposed', async () => {
    let resolveState: ((state: unknown) => void) | undefined
    invoke.mockReturnValue(
      new Promise((resolve) => {
        resolveState = resolve
      })
    )
    const updateTab = vi.fn()
    const binding = renderer.get('terminal')?.bindTab?.({
      resourceId: 7,
      sessionId: 'session-1',
      updateTab
    })
    binding?.dispose()
    resolveState?.({ sessionId: 'session-1', terminals: [{ id: 7, title: 'PowerShell' }] })
    await Promise.resolve()
    expect(updateTab).not.toHaveBeenCalled()
  })
})
