// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

describe('workspace client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    window.bridge = {
      invoke,
      on: vi.fn()
    } as never
  })

  it('reads files in bounded sequential chunks and closes the handle', async () => {
    const first = new Uint8Array(256 * 1024).fill(1)
    const second = new Uint8Array([2, 3])
    invoke.mockImplementation((channel: string) => {
      if (channel === 'workspace:file-open') return Promise.resolve(7)
      if (channel === 'workspace:file-read') {
        const reads = invoke.mock.calls.filter(([name]) => name === 'workspace:file-read').length
        return Promise.resolve(reads === 1 ? first : reads === 2 ? second : new Uint8Array())
      }
      return Promise.resolve(undefined)
    })
    const { workspaceClient } =
      await import('../../../../src/extensions/workspace/renderer/workspace-client')

    const content = await workspaceClient.readFile('D:\\workspace\\large.bin')

    expect(content).toHaveLength(first.byteLength + second.byteLength)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'workspace:file-read')).toEqual([
      ['workspace:file-read', 7, 0, 256 * 1024],
      ['workspace:file-read', 7, 256 * 1024, 256 * 1024],
      ['workspace:file-read', 7, 256 * 1024 + 2, 256 * 1024]
    ])
    expect(invoke).toHaveBeenLastCalledWith('workspace:file-close', 7)
  })

  it('closes the handle when reading fails', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'workspace:file-open') return Promise.resolve(9)
      if (channel === 'workspace:file-read') return Promise.reject(new Error('read failed'))
      return Promise.resolve(undefined)
    })
    const { workspaceClient } =
      await import('../../../../src/extensions/workspace/renderer/workspace-client')

    await expect(workspaceClient.readFile('D:\\workspace\\file.bin')).rejects.toThrow('read failed')
    expect(invoke).toHaveBeenLastCalledWith('workspace:file-close', 9)
  })

  it('does not read or close a missing file', async () => {
    invoke.mockResolvedValue(null)
    const { workspaceClient } =
      await import('../../../../src/extensions/workspace/renderer/workspace-client')

    await expect(workspaceClient.readFile('D:\\workspace\\missing.bin')).resolves.toBeNull()
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('workspace:file-open', 'D:\\workspace\\missing.bin')
  })
})
