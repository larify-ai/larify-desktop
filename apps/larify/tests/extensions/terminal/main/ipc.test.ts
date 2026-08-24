import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionTerminalsState } from '../../../../src/extensions/terminal/shared/types'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const sends: Array<{ channel: string; payload: unknown }> = []
  const window = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn((channel: string, payload: unknown) => sends.push({ channel, payload }))
    }
  }
  return {
    handlers,
    sends,
    window,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
})

vi.mock('electron', () => ({
  ipcMain: electronMock.ipcMain
}))

async function importIpc(): Promise<typeof import('../../../../src/extensions/terminal/main/ipc')> {
  return import('../../../../src/extensions/terminal/main/ipc')
}

class FakeTerminalService {
  write = vi.fn()
  resize = vi.fn()
  snapshot = vi.fn(async () => ({ data: 'snapshot', cols: 80, rows: 24 }))
  state = vi.fn((sessionId: string): SessionTerminalsState => ({ sessionId, terminals: [] }))
  unbindChange = vi.fn()
  unbindData = vi.fn()
  unbindExit = vi.fn()
  unbindCommandFinished = vi.fn()
  private changeCallback?: (state: SessionTerminalsState) => void
  private dataCallback?: (
    sessionId: string,
    terminalId: number,
    data: string,
    start?: number,
    end?: number
  ) => void
  private exitCallback?: (sessionId: string, terminalId: number, exitCode: number) => void
  private commandFinishedCallback?: (
    sessionId: string,
    terminalId: number,
    event: { exitCode?: number }
  ) => void
  terminalState = vi.fn((_sessionId: string, terminalId: number) => ({
    id: terminalId,
    cwd: 'D:\\workspace'
  }))

  bindChange(callback: (state: SessionTerminalsState) => void): () => void {
    this.changeCallback = callback
    return this.unbindChange
  }

  bindData(
    callback: (
      sessionId: string,
      terminalId: number,
      data: string,
      start?: number,
      end?: number
    ) => void
  ): () => void {
    this.dataCallback = callback
    return this.unbindData
  }

  bindExit(
    callback: (sessionId: string, terminalId: number, exitCode: number) => void
  ): () => void {
    this.exitCallback = callback
    return this.unbindExit
  }

  bindCommandFinished(
    callback: (sessionId: string, terminalId: number, event: { exitCode?: number }) => void
  ): () => void {
    this.commandFinishedCallback = callback
    return this.unbindCommandFinished
  }

  emitChange(state: SessionTerminalsState): void {
    this.changeCallback?.(state)
  }

  emitData(
    sessionId: string,
    terminalId: number,
    data: string,
    start?: number,
    end?: number
  ): void {
    this.dataCallback?.(sessionId, terminalId, data, start, end)
  }

  emitExit(sessionId: string, terminalId: number, exitCode: number): void {
    this.exitCallback?.(sessionId, terminalId, exitCode)
  }

  emitCommandFinished(sessionId: string, terminalId: number, exitCode?: number): void {
    this.commandFinishedCallback?.(sessionId, terminalId, { exitCode })
  }
}

beforeEach(() => {
  vi.useRealTimers()
  electronMock.handlers.clear()
  electronMock.sends.length = 0
  electronMock.ipcMain.handle.mockClear()
  electronMock.ipcMain.removeHandler.mockClear()
  electronMock.window.isDestroyed.mockReset()
  electronMock.window.isDestroyed.mockReturnValue(false)
  electronMock.window.webContents.isDestroyed.mockReset()
  electronMock.window.webContents.isDestroyed.mockReturnValue(false)
  electronMock.window.webContents.send.mockClear()
})

describe('registerTerminalIpc', () => {
  it('registers terminal renderer handlers and forwards them to the service', async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()

    registerTerminalIpc(service as never, electronMock.window as never)

    expect(electronMock.ipcMain.handle).toHaveBeenCalledTimes(4)
    expect(electronMock.handlers.get('terminal:getState')?.({}, 'session-1')).toEqual({
      sessionId: 'session-1',
      terminals: []
    })
    electronMock.handlers.get('terminal:write')?.({}, 'session-1', 7, 'echo hi\r')
    electronMock.handlers.get('terminal:resize')?.({}, 'session-1', 7, 120, 30)
    await expect(
      electronMock.handlers.get('terminal:snapshot')?.({}, 'session-1', 7)
    ).resolves.toEqual({
      data: 'snapshot',
      cols: 80,
      rows: 24
    })
    expect(service.write).toHaveBeenCalledWith('session-1', 7, 'echo hi\r')
    expect(service.resize).toHaveBeenCalledWith('session-1', 7, 120, 30)
    expect(service.snapshot).toHaveBeenCalledWith('session-1', 7)
  })

  it('sends state events to renderer windows', async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never, electronMock.window as never)

    service.emitChange({ sessionId: 'session-1', terminals: [] })

    expect(electronMock.sends).toEqual([
      {
        channel: 'terminal:state',
        payload: { sessionId: 'session-1', terminals: [] }
      }
    ])
  })

  it('sends command completion with the terminal working directory', async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never, electronMock.window as never)

    service.emitCommandFinished('session-1', 7, 0)

    expect(electronMock.sends).toEqual([
      {
        channel: 'terminal:command-finished',
        payload: { sessionId: 'session-1', terminalId: 7, cwd: 'D:\\workspace', exitCode: 0 }
      }
    ])
  })

  it('does not send events after the main window is destroyed', async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never, electronMock.window as never)
    electronMock.window.isDestroyed.mockReturnValue(true)

    service.emitChange({ sessionId: 'session-1', terminals: [] })

    expect(electronMock.sends).toEqual([])
  })

  it('does not send events after the renderer web contents is destroyed', async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never, electronMock.window as never)
    electronMock.window.webContents.isDestroyed.mockReturnValue(true)

    service.emitChange({ sessionId: 'session-1', terminals: [] })

    expect(electronMock.sends).toEqual([])
  })

  it('batches data events before sending them to the renderer', async () => {
    vi.useFakeTimers()
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never, electronMock.window as never)

    service.emitData('session-1', 7, 'a', 5, 6)
    service.emitData('session-1', 7, 'b', 6, 7)
    expect(electronMock.sends).toEqual([])

    vi.advanceTimersByTime(10)

    expect(electronMock.sends).toEqual([
      {
        channel: 'terminal:data',
        payload: { sessionId: 'session-1', terminalId: 7, data: 'ab', start: 5, end: 7 }
      }
    ])
    vi.useRealTimers()
  })

  it('flushes and removes pending data when a resource leaves terminal state', async () => {
    vi.useFakeTimers()
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never, electronMock.window as never)

    service.emitData('session-1', 7, 'pending', 0, 7)
    service.emitChange({ sessionId: 'session-1', terminals: [] })

    expect(electronMock.sends).toEqual([
      {
        channel: 'terminal:data',
        payload: { sessionId: 'session-1', terminalId: 7, data: 'pending', start: 0, end: 7 }
      },
      {
        channel: 'terminal:state',
        payload: { sessionId: 'session-1', terminals: [] }
      }
    ])
    electronMock.sends.length = 0
    vi.advanceTimersByTime(10)
    expect(electronMock.sends).toEqual([])
    vi.useRealTimers()
  })

  it('flushes pending data before exit events', async () => {
    vi.useFakeTimers()
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    registerTerminalIpc(service as never, electronMock.window as never)

    service.emitData('session-1', 7, 'pending')
    service.emitExit('session-1', 7, 0)

    expect(electronMock.sends).toEqual([
      {
        channel: 'terminal:data',
        payload: { sessionId: 'session-1', terminalId: 7, data: 'pending' }
      },
      { channel: 'terminal:exit', payload: { sessionId: 'session-1', terminalId: 7, exitCode: 0 } }
    ])

    vi.useRealTimers()
  })

  it('unbinds service listeners and removes handlers on dispose', async () => {
    const { registerTerminalIpc } = await importIpc()
    const service = new FakeTerminalService()
    const dispose = registerTerminalIpc(service as never, electronMock.window as never)

    dispose()

    expect(service.unbindChange).toHaveBeenCalled()
    expect(service.unbindData).toHaveBeenCalled()
    expect(service.unbindExit).toHaveBeenCalled()
    expect(service.unbindCommandFinished).toHaveBeenCalled()
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledTimes(4)
    expect(electronMock.handlers.size).toBe(0)
  })
})
