// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const on = vi.fn()

describe('workspace client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    window.bridge = { invoke, on } as never
  })

  it('forwards workspace requests', async () => {
    const { workspaceClient } =
      await import('../../../../src/extensions/workspace/renderer/workspace-client')

    void workspaceClient.readDirectory(7, 'D:\\workspace\\src')
    void workspaceClient.readDirectory(8)
    void workspaceClient.inspectFile(7, 'D:\\workspace\\src\\file.ts')
    void workspaceClient.readFile(7, 'D:\\workspace\\src\\file.ts')
    void workspaceClient.reveal(7, 'D:\\workspace\\src\\file.ts')

    expect(invoke).toHaveBeenCalledWith('workspace:list', 7, 'D:\\workspace\\src')
    expect(invoke).toHaveBeenCalledWith('workspace:list', 8, undefined)
    expect(invoke).toHaveBeenCalledWith('workspace:inspect', 7, 'D:\\workspace\\src\\file.ts')
    expect(invoke).toHaveBeenCalledWith('workspace:read', 7, 'D:\\workspace\\src\\file.ts')
    expect(invoke).toHaveBeenCalledWith('workspace:reveal', 7, 'D:\\workspace\\src\\file.ts')
  })

  it('forwards changes only for the requested resource', async () => {
    let change!: (...args: unknown[]) => void
    const unsubscribe = vi.fn()
    on.mockImplementation((_channel, listener) => {
      change = listener
      return unsubscribe
    })
    const listener = vi.fn()
    const { workspaceClient } =
      await import('../../../../src/extensions/workspace/renderer/workspace-client')

    const result = workspaceClient.onDidChange(7, listener)
    change(8, 'D:\\other', 'D:\\other\\file.ts')
    change(7, 'D:\\workspace', 'D:\\workspace\\file.ts')

    expect(on).toHaveBeenCalledWith('workspace:change', expect.any(Function))
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith('D:\\workspace', 'D:\\workspace\\file.ts')
    expect(result).toBe(unsubscribe)
  })
})
