import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/shared/infra/registry'

const mocks = vi.hoisted(() => ({
  disposeIpc: vi.fn(),
  registerIpc: vi.fn()
}))

vi.mock('../../../../src/main/core/resource/ipc', () => ({
  registerResourceIpc: mocks.registerIpc
}))

import { ResourceManager } from '../../../../src/main/core/resource/manager'
import {
  registerResourceManager,
  resourceManagerToken
} from '../../../../src/main/core/resource/open'

beforeEach(() => {
  mocks.disposeIpc.mockReset()
  mocks.registerIpc.mockReset().mockReturnValue(mocks.disposeIpc)
})

describe('registerResourceManager', () => {
  it('registers the manager and disposes IPC before resources', async () => {
    const order: string[] = []
    const registry = new Registry()
    const window = { get: vi.fn(() => ({ id: 'window' })) }

    registerResourceManager({ registry, window } as never)

    const manager = registry.get<ResourceManager>(resourceManagerToken)
    expect(manager).toBeInstanceOf(ResourceManager)
    expect(mocks.registerIpc).toHaveBeenCalledWith(manager, window.get())
    mocks.disposeIpc.mockImplementation(() => order.push('ipc'))
    vi.spyOn(manager!, 'dispose').mockImplementation(async () => {
      order.push('resources')
    })

    await registry.disposeAll()

    expect(order).toEqual(['ipc', 'resources'])
  })
})
