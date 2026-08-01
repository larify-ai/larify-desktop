import { beforeEach, describe, expect, it, vi } from 'vitest'

const dispose = vi.fn(async () => undefined)

vi.mock('../../../../src/extensions/embedding/main/worker-client', () => ({
  EmbeddingWorker: class {
    dispose = dispose
  }
}))

import extension, { getEmbeddingWorker } from '../../../../src/extensions/embedding/main'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Embedding extension', () => {
  it('reuses the worker until the extension is disposed', () => {
    const subscriptions: Array<{ dispose(): void }> = []
    const before = getEmbeddingWorker()
    const unregister = { dispose: vi.fn() }
    const app = { register: vi.fn(() => unregister) }

    expect(getEmbeddingWorker()).toBe(before)
    extension.activate?.(app as never, { subscriptions } as never)
    expect(app.register).toHaveBeenCalledWith('service', 'embedding', before)
    subscriptions[1].dispose()

    expect(dispose).toHaveBeenCalledOnce()
    expect(getEmbeddingWorker()).not.toBe(before)
  })
})
