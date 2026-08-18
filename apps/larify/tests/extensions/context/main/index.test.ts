import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginHost } from '../../../../src/main/core/plugin/host'
import { Registry } from '../../../../src/shared/infra/registry'
import { embeddingWorkerToken } from '../../../../src/extensions/embedding/main/service'
import { contextWorkerToken } from '../../../../src/extensions/context/main/service'

const mocks = vi.hoisted(() => ({
  open: vi.fn<() => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
  duplicateName: vi.fn<() => Promise<boolean>>(),
  disposeDiagnostics: vi.fn(),
  registerDiagnostics: vi.fn(),
  createDiagnostics: vi.fn(() => ({ matches: vi.fn(), provide: vi.fn() }))
}))

vi.mock('../../../../src/extensions/context/main/worker-client', async () => {
  return {
    ContextWorker: class {
      open = mocks.open
      dispose = mocks.dispose
      duplicateName = mocks.duplicateName
    }
  }
})
vi.mock('../../../../src/extensions/context/main/indexer', () => ({
  memoryRootPath: () => 'memory'
}))
vi.mock('../../../../src/extensions/context/main/diagnostics', () => ({
  createContextDiagnosticsProvider: mocks.createDiagnostics
}))
vi.mock('../../../../src/extensions/fs/main/diagnostics', () => ({
  registerFileDiagnosticsProvider: mocks.registerDiagnostics
}))

import plugin from '../../../../src/extensions/context/main'

describe('context plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.open.mockResolvedValue()
    mocks.dispose.mockResolvedValue()
    mocks.duplicateName.mockResolvedValue(false)
    mocks.registerDiagnostics.mockReturnValue(mocks.disposeDiagnostics)
  })

  it('opens shared memory and disposes its services', async () => {
    const registry = new Registry()
    registry.register(embeddingWorkerToken, {})
    const host = new PluginHost(registry)

    await host.activate(plugin)
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(registry.get(contextWorkerToken)).toBeDefined()
    expect(mocks.createDiagnostics).toHaveBeenCalledWith('memory', expect.any(Function))

    await host.deactivate('context')
    expect(mocks.disposeDiagnostics).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(registry.get(contextWorkerToken)).toBeUndefined()
  })

  it('rolls back diagnostics and worker when opening fails', async () => {
    mocks.open.mockRejectedValueOnce(new Error('open failed'))
    const registry = new Registry()
    const host = new PluginHost(registry)

    await expect(host.activate(plugin)).rejects.toThrow('open failed')
    expect(mocks.disposeDiagnostics).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })

  it('does not register diagnostics when the context service is occupied', async () => {
    const existing = { dispose: vi.fn() }
    const registry = new Registry()
    registry.register(contextWorkerToken, existing)
    const host = new PluginHost(registry)

    await expect(host.activate(plugin)).rejects.toThrow('Service is already registered')
    expect(mocks.registerDiagnostics).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
    expect(registry.get(contextWorkerToken)).toBe(existing)
  })
})
