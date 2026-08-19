import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginHost } from '../../../../src/main/core/plugin/host'
import { Registry } from '../../../../src/shared/infra/registry'
import { contextWorkerToken } from '../../../../src/extensions/context/main/service'

const mocks = vi.hoisted(() => ({
  dispose: vi.fn<() => Promise<void>>(),
  duplicateName: vi.fn<() => Promise<boolean>>(),
  disposeDiagnostics: vi.fn(),
  registerDiagnostics: vi.fn(),
  openGit: vi.fn(),
  checkIsRepo: vi.fn<() => Promise<boolean>>(),
  initGit: vi.fn<() => Promise<void>>(),
  createDiagnostics: vi.fn(() => ({ matches: vi.fn(), provide: vi.fn() }))
}))

vi.mock('../../../../src/extensions/context/main/worker-client', async () => {
  return {
    ContextWorker: class {
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
vi.mock('../../../../src/main/core/git', () => ({
  gitService: { open: mocks.openGit }
}))
vi.mock('../../../../src/extensions/fs/main/diagnostics', () => ({
  registerFileDiagnosticsProvider: mocks.registerDiagnostics
}))

import plugin from '../../../../src/extensions/context/main'

describe('context plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dispose.mockResolvedValue()
    mocks.duplicateName.mockResolvedValue(false)
    mocks.checkIsRepo.mockResolvedValue(true)
    mocks.initGit.mockResolvedValue()
    mocks.openGit.mockResolvedValue({
      checkIsRepo: mocks.checkIsRepo,
      init: mocks.initGit
    })
    mocks.registerDiagnostics.mockReturnValue(mocks.disposeDiagnostics)
  })

  it('registers lazy memory services without starting the worker', async () => {
    const registry = new Registry()
    const host = new PluginHost(registry)

    await host.activate(plugin)
    expect(mocks.openGit).toHaveBeenCalledWith('memory')
    expect(mocks.initGit).not.toHaveBeenCalled()
    expect(registry.get(contextWorkerToken)).toBeDefined()
    expect(mocks.createDiagnostics).toHaveBeenCalledWith('memory', expect.any(Function))

    await host.deactivate('context')
    expect(mocks.disposeDiagnostics).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(registry.get(contextWorkerToken)).toBeUndefined()
  })

  it('initializes the memory Git repository when it is missing', async () => {
    mocks.checkIsRepo.mockResolvedValue(false)
    const host = new PluginHost(new Registry())

    await host.activate(plugin)

    expect(mocks.initGit).toHaveBeenCalledOnce()
  })

  it('does not register diagnostics when the context service is occupied', async () => {
    const existing = { dispose: vi.fn() }
    const registry = new Registry()
    registry.register(contextWorkerToken, existing)
    const host = new PluginHost(registry)

    await expect(host.activate(plugin)).rejects.toThrow('Service is already registered')
    expect(mocks.registerDiagnostics).not.toHaveBeenCalled()
    expect(registry.get(contextWorkerToken)).toBe(existing)
  })
})
