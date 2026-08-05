import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanContextRegistry: vi.fn(),
  registerContext: vi.fn(),
  createDiagnostics: vi.fn(() => ({ matches: vi.fn(), provide: vi.fn() })),
  disposeDiagnostics: vi.fn(),
  registerDiagnostics: vi.fn(),
  open: vi.fn<(...args: unknown[]) => Promise<void>>(),
  close: vi.fn<(...args: unknown[]) => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
  duplicateName: vi.fn<(...args: unknown[]) => Promise<boolean>>()
}))

vi.mock('../../../../src/extensions/context/main/workspace', () => ({
  cleanContextRegistry: mocks.cleanContextRegistry,
  registerContext: mocks.registerContext
}))

vi.mock('../../../../src/extensions/context/main/diagnostics', () => ({
  createContextDiagnosticsProvider: mocks.createDiagnostics
}))

vi.mock('../../../../src/extensions/fs/main/diagnostics', () => ({
  registerFileDiagnosticsProvider: mocks.registerDiagnostics
}))

vi.mock('../../../../src/extensions/context/main/worker-client', () => ({
  ContextWorker: class {
    open = mocks.open
    close = mocks.close
    dispose = mocks.dispose
    duplicateName = mocks.duplicateName
  }
}))

import extension from '../../../../src/extensions/context/main'

interface Fixture {
  app: {
    register: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }
  listener: { dispose: ReturnType<typeof vi.fn> }
  open: (cwd: unknown) => void
  subscriptions: Array<{ dispose(): void | Promise<void> }>
}

function activate(): Fixture {
  const subscriptions: Array<{ dispose(): void | Promise<void> }> = []
  let openWorkspace: ((cwd: unknown) => void) | undefined
  const listener = { dispose: vi.fn() }
  const app = {
    register: vi.fn(() => ({ dispose: vi.fn() })),
    on: vi.fn((_event: string, handler: (cwd: unknown) => void) => {
      openWorkspace = handler
      return listener
    })
  }

  extension.activate(app as never, { subscriptions } as never)
  return { app, listener, open: (cwd) => openWorkspace?.(cwd), subscriptions }
}

describe('context extension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.registerDiagnostics.mockReturnValue(mocks.disposeDiagnostics)
    mocks.open.mockResolvedValue()
    mocks.close.mockResolvedValue()
    mocks.dispose.mockResolvedValue()
    mocks.duplicateName.mockResolvedValue(false)
  })

  it('registers the context service and workspace listener', () => {
    const { app, subscriptions } = activate()

    expect(mocks.cleanContextRegistry).toHaveBeenCalledOnce()
    expect(app.register).toHaveBeenCalledWith('service', 'context', expect.anything())
    expect(app.on).toHaveBeenCalledWith('workspace:open', expect.any(Function))
    expect(subscriptions).toHaveLength(1)
  })

  it('ignores invalid and duplicate workspace events', () => {
    const { open } = activate()

    open(undefined)
    open('workspace')
    open('workspace')

    expect(mocks.registerContext).toHaveBeenCalledOnce()
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(mocks.registerDiagnostics).toHaveBeenCalledOnce()
  })

  it('opens normalized workspaces and connects duplicate-name diagnostics', async () => {
    const { open } = activate()
    open('workspace/../workspace')

    const workspace = expect.stringMatching(/[\\/]workspace$/)
    expect(mocks.registerContext).toHaveBeenCalledWith(workspace)
    expect(mocks.open).toHaveBeenCalledWith(workspace)
    expect(mocks.createDiagnostics).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]workspace[\\/]\.larify$/),
      expect.any(Function)
    )

    const duplicateName = mocks.createDiagnostics.mock.calls[0][1]
    await duplicateName('file.md', 'Name')
    expect(mocks.duplicateName).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]workspace$/),
      'file.md',
      'Name'
    )
  })

  it('reports worker open failures', async () => {
    const error = new Error('open failed')
    mocks.open.mockRejectedValueOnce(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fixture = activate()
    fixture.open('workspace')
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[context:open]', error))
    expect(mocks.disposeDiagnostics).toHaveBeenCalledOnce()

    fixture.open('workspace')
    expect(mocks.open).toHaveBeenCalledTimes(2)
    log.mockRestore()
  })

  it('does not clean an already disposed workspace twice when opening fails late', async () => {
    let rejectOpen!: (error: Error) => void
    mocks.open.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectOpen = reject))
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { open, subscriptions } = activate()
    open('workspace')

    await subscriptions[0].dispose()
    rejectOpen(new Error('late failure'))
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce())

    expect(mocks.disposeDiagnostics).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  it('waits for workspace and worker disposal', async () => {
    let releaseClose!: () => void
    let releaseWorker!: () => void
    mocks.close.mockImplementation(() => new Promise<void>((resolve) => (releaseClose = resolve)))
    mocks.dispose.mockImplementation(
      () => new Promise<void>((resolve) => (releaseWorker = resolve))
    )
    const { open, subscriptions } = activate()
    open('workspace')

    const disposal = subscriptions[0].dispose()
    expect(disposal).toBeInstanceOf(Promise)
    expect(mocks.disposeDiagnostics).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.dispose).not.toHaveBeenCalled()

    releaseClose()
    await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledOnce())
    releaseWorker()
    await disposal
  })
})
