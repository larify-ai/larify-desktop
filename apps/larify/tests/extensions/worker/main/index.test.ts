import { describe, expect, it } from 'vitest'
import { ExtensionHost } from '../../../../src/main/core/extension'
import extension, { workerService } from '../../../../src/extensions/worker/main'
import { WorkerService } from '../../../../src/extensions/worker/main/worker-service'

describe('Worker extension', () => {
  it('registers its service', async () => {
    const host = new ExtensionHost()

    await host.activate(extension)

    expect(host.getService(workerService)).toBeInstanceOf(WorkerService)
    await host.deactivate(extension.name)
  })
})
