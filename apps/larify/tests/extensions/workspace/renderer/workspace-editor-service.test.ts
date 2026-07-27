// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const monaco = vi.hoisted(() => ({
  monacoReady: Promise.resolve(),
  observeActiveWorkspaceFile: vi.fn(),
  openWorkspaceDiff: vi.fn(),
  openWorkspaceFile: vi.fn(),
  setWorkspaceRoot: vi.fn(),
  setWorkspaceTheme: vi.fn()
}))
const workspaceClient = vi.hoisted(() => ({
  allowFile: vi.fn(),
  open: vi.fn()
}))

vi.mock('../../../../src/extensions/workspace/renderer/monaco', () => monaco)
vi.mock('../../../../src/extensions/workspace/renderer/workspace-client', () => ({
  workspaceClient
}))

const deferred = <T>(): {
  promise: Promise<T>
  resolve(value: T): void
} => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('workspace editor service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    monaco.setWorkspaceRoot.mockResolvedValue(undefined)
    monaco.openWorkspaceFile.mockResolvedValue(undefined)
    monaco.openWorkspaceDiff.mockResolvedValue(undefined)
    workspaceClient.allowFile.mockImplementation(async (file: string) => file)
    workspaceClient.open.mockImplementation(async (root: string) => root)
  })

  it('serializes workspace root changes', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    monaco.setWorkspaceRoot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { prepareWorkspaceRoot } =
      await import('../../../../src/extensions/workspace/renderer/workspace-editor-service')

    const prepareFirst = prepareWorkspaceRoot('D:\\first')
    const prepareSecond = prepareWorkspaceRoot('D:\\second')
    await vi.waitFor(() => expect(monaco.setWorkspaceRoot).toHaveBeenCalledTimes(1))

    first.resolve()
    await prepareFirst
    await vi.waitFor(() => expect(monaco.setWorkspaceRoot).toHaveBeenCalledTimes(2))
    second.resolve()
    await prepareSecond

    expect(monaco.setWorkspaceRoot.mock.calls).toEqual([['D:\\first'], ['D:\\second']])
  })

  it('retries a workspace root after initialization fails', async () => {
    monaco.setWorkspaceRoot
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined)
    const { prepareWorkspaceRoot } =
      await import('../../../../src/extensions/workspace/renderer/workspace-editor-service')

    await expect(prepareWorkspaceRoot('D:\\workspace')).rejects.toThrow('failed')
    await expect(prepareWorkspaceRoot('D:\\workspace')).resolves.toBeUndefined()

    expect(monaco.setWorkspaceRoot).toHaveBeenCalledTimes(2)
  })

  it('explicitly allows a file outside the current workspace before opening it', async () => {
    const { openWorkspaceFile } =
      await import('../../../../src/extensions/workspace/renderer/workspace-editor-service')

    await expect(openWorkspaceFile('D:\\workspace', 'D:\\other\\file.ts')).resolves.toBeUndefined()

    expect(workspaceClient.allowFile).toHaveBeenCalledWith('D:\\other\\file.ts')
    expect(workspaceClient.open).toHaveBeenCalledWith('D:\\workspace')
    expect(monaco.setWorkspaceRoot).toHaveBeenCalledWith('D:\\workspace')
    expect(monaco.openWorkspaceFile).toHaveBeenCalledWith('D:\\other\\file.ts')
    expect(workspaceClient.open.mock.invocationCallOrder[0]).toBeLessThan(
      workspaceClient.allowFile.mock.invocationCallOrder[0]
    )
  })

  it('opens a changed file with the native diff editor', async () => {
    const { openWorkspaceDiff } =
      await import('../../../../src/extensions/workspace/renderer/workspace-editor-service')

    await openWorkspaceDiff('D:\\workspace', 'D:\\workspace\\changed.ts')

    expect(monaco.setWorkspaceRoot).toHaveBeenCalledWith('D:\\workspace')
    expect(monaco.openWorkspaceDiff).toHaveBeenCalledWith('D:\\workspace\\changed.ts')
  })
})
