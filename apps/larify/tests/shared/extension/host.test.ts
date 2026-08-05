import { describe, expect, it, vi } from 'vitest'
import { ExtensionHost } from '../../../src/main/core/extension'
import type { Extension } from '../../../src/shared/extension'

describe('ExtensionHost', () => {
  it('runs the extension lifecycle', async () => {
    const deactivate = vi.fn()
    const extension: Extension = {
      name: 'test',
      description: 'Test extension',
      activate: vi.fn(),
      deactivate
    }
    const host = new ExtensionHost()

    await host.activate(extension)
    await host.deactivate(extension.name)

    expect(deactivate).toHaveBeenCalledOnce()
  })

  it('ignores an extension that is not active', async () => {
    await expect(new ExtensionHost().deactivate('missing')).resolves.toBeUndefined()
  })
})
