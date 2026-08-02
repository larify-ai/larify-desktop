import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDiagnostics: vi.fn(() => ({ matches: vi.fn(), provide: vi.fn() })),
  disposeDiagnostics: vi.fn(),
  registerDiagnostics: vi.fn()
}))

vi.mock('../../../../src/extensions/nest/main/diagnostics', () => ({
  createTaskDiagnosticsProvider: mocks.createDiagnostics
}))

vi.mock('../../../../src/extensions/file/main/diagnostics', () => ({
  registerFileDiagnosticsProvider: mocks.registerDiagnostics
}))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  larifyPath: (...segments: string[]) => ['.larify', ...segments].join('/')
}))

import extension from '../../../../src/extensions/nest/main'

describe('nest extension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.registerDiagnostics.mockReturnValue(mocks.disposeDiagnostics)
  })

  it('registers and disposes task diagnostics', () => {
    const subscriptions: Array<{ dispose(): void }> = []

    extension.activate({} as never, { subscriptions } as never)

    expect(mocks.createDiagnostics).toHaveBeenCalledWith('.larify/tasks')
    expect(mocks.registerDiagnostics).toHaveBeenCalledWith(
      mocks.createDiagnostics.mock.results[0].value
    )
    expect(subscriptions).toHaveLength(1)

    subscriptions[0].dispose()
    expect(mocks.disposeDiagnostics).toHaveBeenCalledOnce()
  })
})
