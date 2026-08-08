import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '../../../../src/main/infra/registry'

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}))
const files = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: electron
}))

vi.mock('../../../../src/main/core/attachment/files', () => ({
  saveAttachments: files.save,
  loadAttachments: files.load
}))

import { registerAttachment } from '../../../../src/main/core/attachment/open'

beforeEach(() => {
  electron.handle.mockReset()
  electron.removeHandler.mockReset()
  files.save.mockReset()
  files.load.mockReset()
})

describe('registerAttachment', () => {
  it('registers and disposes both IPC handlers', async () => {
    const registry = new Registry()
    registerAttachment({ registry } as never)

    expect(electron.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'attachment:save',
      'attachment:load'
    ])

    await registry.disposeAll()
    expect(electron.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      'attachment:save',
      'attachment:load'
    ])
  })

  it('forwards IPC arguments and results', async () => {
    const saved = { id: 'message', role: 'user', parts: [] }
    const loaded = [saved]
    files.save.mockResolvedValue(saved)
    files.load.mockResolvedValue(loaded)
    registerAttachment({ registry: new Registry() } as never)

    const handlers = Object.fromEntries(electron.handle.mock.calls)
    await expect(handlers['attachment:save']({}, 'session', saved)).resolves.toBe(saved)
    await expect(handlers['attachment:load']({}, loaded)).resolves.toBe(loaded)
    expect(files.save).toHaveBeenCalledWith('session', saved)
    expect(files.load).toHaveBeenCalledWith(loaded)
  })
})
