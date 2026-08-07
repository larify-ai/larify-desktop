import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  handlers: new Map<string, (...args: never[]) => unknown>(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: mocks.removeHandler
  }
}))

import { registerDialogIpc } from '../../../src/main/dialog/ipc'

beforeEach(() => {
  mocks.fromWebContents.mockReset()
  mocks.handlers.clear()
  mocks.removeHandler.mockReset()
  mocks.showOpenDialog.mockReset()
})

describe('dialog IPC', () => {
  it('selects multiple directories and removes its handler', async () => {
    const window = {}
    const sender = {}
    mocks.fromWebContents.mockReturnValue(window)
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a', 'C:\\b'] })
    const disposable = registerDialogIpc({ window: { get: () => window } } as never)

    const result = await mocks.handlers.get('dialog:pick-directories')!({ sender } as never)

    expect(mocks.fromWebContents).toHaveBeenCalledWith(sender)
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(window, {
      properties: ['openDirectory', 'multiSelections']
    })
    expect(result).toEqual(['C:\\a', 'C:\\b'])
    disposable.dispose()
    expect(mocks.removeHandler).toHaveBeenCalledWith('dialog:pick-directories')
  })

  it('returns no paths when selection is cancelled', async () => {
    mocks.fromWebContents.mockReturnValue(null)
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: ['ignored'] })
    const window = {}
    registerDialogIpc({ window: { get: () => window } } as never)

    await expect(
      mocks.handlers.get('dialog:pick-directories')!({ sender: {} } as never)
    ).resolves.toEqual([])
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(window, {
      properties: ['openDirectory', 'multiSelections']
    })
  })
})
