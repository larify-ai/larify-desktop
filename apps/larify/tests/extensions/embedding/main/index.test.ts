import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'
import { PluginHost } from '../../../../src/main/core/plugin/host'

const dispose = vi.fn(async () => undefined)

vi.mock('../../../../src/extensions/embedding/main/worker-client', () => ({
  EmbeddingWorker: class {
    dispose = dispose
  }
}))

import plugin from '../../../../src/extensions/embedding/main'
import { embeddingWorkerToken } from '../../../../src/extensions/embedding/main/service'

describe('Embedding plugin', () => {
  it('registers its worker service and disposes it on deactivation', async () => {
    const registry = new Registry()
    const host = new PluginHost(registry)

    await host.activate(plugin)

    expect(registry.get(embeddingWorkerToken)).toBeDefined()
    await host.deactivate('embedding')

    expect(dispose).toHaveBeenCalledOnce()
    expect(registry.get(embeddingWorkerToken)).toBeUndefined()
  })
})
