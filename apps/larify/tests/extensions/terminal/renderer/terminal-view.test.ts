// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const terminals: MockTerminal[] = []

class MockTerminal {
  unicode = { activeVersion: '' }
  options = {}
  dispose = vi.fn()
  loadAddon = vi.fn()
  open = vi.fn()
  resize = vi.fn()
  write = vi.fn((_data: string, callback?: () => void) => callback?.())
  onDataCallback?: (data: string) => void
  onResizeCallback?: (size: { cols: number; rows: number }) => void

  constructor(readonly constructorOptions: unknown) {
    terminals.push(this)
  }

  attachCustomKeyEventHandler = vi.fn()
  blur = vi.fn()
  clearSelection = vi.fn()
  getSelection(): string {
    return ''
  }
  paste = vi.fn()
  onData(callback: (data: string) => void): { dispose(): void } {
    this.onDataCallback = callback
    return { dispose: vi.fn() }
  }
  onResize(callback: (size: { cols: number; rows: number }) => void): { dispose(): void } {
    this.onResizeCallback = callback
    return { dispose: vi.fn() }
  }
}

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' })
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }))

describe('TerminalView', () => {
  let container: HTMLDivElement
  let root: Root
  let listeners: Record<string, (payload: unknown) => void>
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    terminals.length = 0
    listeners = {}
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe = vi.fn()
        disconnect = vi.fn()
      }
    })
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)
    })
    invoke = vi.fn((channel: string) =>
      Promise.resolve(
        channel === 'terminal:snapshot'
          ? { data: 'snapshot', cols: 80, rows: 24, seq: 8 }
          : channel === 'terminal:getState'
            ? {
                activeId: 42,
                sessionId: 'session-1',
                terminals: [{ id: 42, title: 'PowerShell', exitCode: null }]
              }
            : undefined
      )
    )
    Object.defineProperty(window, 'bridge', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn((channel: string, callback: (payload: unknown) => void) => {
          listeners[channel] = callback
          return () => {
            delete listeners[channel]
          }
        })
      }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function renderTerminal(id = 42, updateTab = vi.fn()): Promise<MockTerminal> {
    const { TerminalView } =
      await import('../../../../src/extensions/terminal/renderer/terminal-view')
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          resourceId: id,
          sessionId: 'session-1',
          updateTab
        })
      )
    })
    return terminals[0]
  }

  it('restores the requested resource snapshot', async () => {
    const terminal = await renderTerminal(42)
    expect(invoke).toHaveBeenCalledWith('terminal:snapshot', 'session-1', 42)
    expect(terminal.resize).toHaveBeenCalledWith(80, 24)
    expect(terminal.write).toHaveBeenCalledWith('snapshot', expect.any(Function))
  })

  it('uses a thin bar cursor', async () => {
    const terminal = await renderTerminal()
    expect(terminal.constructorOptions).toEqual(
      expect.objectContaining({ cursorStyle: 'bar', cursorWidth: 2 })
    )
  })

  it('keeps the xterm instance and disables cursor blinking while inactive', async () => {
    const { TerminalView } =
      await import('../../../../src/extensions/terminal/renderer/terminal-view')
    const render = async (active: boolean): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(TerminalView, {
            active,
            resourceId: 42,
            sessionId: 'session-1',
            updateTab: vi.fn()
          })
        )
      })
    }

    await render(true)
    const terminal = terminals[0]
    await render(false)
    expect(terminals).toHaveLength(1)
    expect(terminal.dispose).not.toHaveBeenCalled()
    expect(terminal.constructorOptions).toEqual(expect.objectContaining({ cursorBlink: false }))
    expect(terminal.blur).toHaveBeenCalledOnce()

    await render(true)
    expect(terminals).toHaveLength(1)
    expect(terminal.constructorOptions).toEqual(expect.objectContaining({ cursorBlink: false }))
  })

  it('routes live output only to the matching resource', async () => {
    const terminal = await renderTerminal(42)
    listeners['terminal:data']?.({
      sessionId: 'session-1',
      terminalId: 7,
      data: 'wrong',
      start: 8,
      end: 13
    })
    listeners['terminal:data']?.({
      sessionId: 'session-1',
      terminalId: 42,
      data: 'right',
      start: 8,
      end: 13
    })
    expect(terminal.write).not.toHaveBeenCalledWith('wrong')
    expect(terminal.write).toHaveBeenCalledWith('right')
  })

  it('routes keyboard input through the resource id', async () => {
    const terminal = await renderTerminal(42)
    terminal.onDataCallback?.('echo hi\r')
    expect(invoke).toHaveBeenCalledWith('terminal:write', 'session-1', 42, 'echo hi\r')
  })

  it('sends terminal dimensions after xterm resizes', async () => {
    const terminal = await renderTerminal(42)
    terminal.onResizeCallback?.({ cols: 120, rows: 36 })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(invoke).toHaveBeenCalledWith('terminal:resize', 'session-1', 42, 120, 36)
  })

  it('stops forwarding input after the process exits', async () => {
    const terminal = await renderTerminal(42)
    listeners['terminal:exit']?.({ sessionId: 'session-1', terminalId: 42, exitCode: 0 })
    listeners['terminal:state']?.({
      activeId: 42,
      sessionId: 'session-1',
      terminals: [{ id: 42, title: 'PowerShell', exitCode: null }]
    })
    terminal.onDataCallback?.('ignored')
    expect(terminal.write).toHaveBeenCalledWith('\r\n[process exited: 0]\r\n')
    expect(invoke).not.toHaveBeenCalledWith('terminal:write', 'session-1', 42, 'ignored')
  })

  it('cancels a queued backend resize when the process exits', async () => {
    const terminal = await renderTerminal(42)
    terminal.onResizeCallback?.({ cols: 120, rows: 36 })
    listeners['terminal:exit']?.({ sessionId: 'session-1', terminalId: 42, exitCode: 0 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })

    expect(invoke).not.toHaveBeenCalledWith('terminal:resize', 'session-1', 42, 120, 36)
  })

  it('shows an exit received during restore after the snapshot', async () => {
    let resolveSnapshot: ((value: unknown) => void) | undefined
    invoke.mockImplementation((channel: string) => {
      if (channel === 'terminal:snapshot') {
        return new Promise((resolve) => {
          resolveSnapshot = resolve
        })
      }
      return Promise.resolve({
        activeId: 42,
        sessionId: 'session-1',
        terminals: [{ id: 42, title: 'PowerShell', exitCode: null }]
      })
    })
    const terminal = await renderTerminal(42)
    listeners['terminal:exit']?.({ sessionId: 'session-1', terminalId: 42, exitCode: 0 })
    expect(terminal.write).not.toHaveBeenCalledWith('\r\n[process exited: 0]\r\n')

    resolveSnapshot?.({ data: 'snapshot', cols: 80, rows: 24, seq: 8 })
    await act(() => Promise.resolve())

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual([
      'snapshot',
      '\r\n[process exited: 0]\r\n'
    ])
  })

  it('does not resize the backend before snapshot restore finishes', async () => {
    let resolveSnapshot: ((value: unknown) => void) | undefined
    invoke.mockImplementation((channel: string) => {
      if (channel === 'terminal:snapshot') {
        return new Promise((resolve) => {
          resolveSnapshot = resolve
        })
      }
      return Promise.resolve({
        activeId: 42,
        sessionId: 'session-1',
        terminals: [{ id: 42, title: 'PowerShell', exitCode: null }]
      })
    })
    const terminal = await renderTerminal(42)
    terminal.onResizeCallback?.({ cols: 120, rows: 36 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(invoke).not.toHaveBeenCalledWith('terminal:resize', 'session-1', 42, 120, 36)

    resolveSnapshot?.({ data: '', cols: 80, rows: 24, seq: 0 })
    await act(() => Promise.resolve())
  })

  it('does not forward input when an already exited terminal is opened', async () => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'terminal:snapshot'
          ? { data: 'snapshot', cols: 80, rows: 24, seq: 8 }
          : channel === 'terminal:getState'
            ? {
                activeId: 42,
                sessionId: 'session-1',
                terminals: [{ id: 42, title: 'PowerShell', exitCode: 0 }]
              }
            : undefined
      )
    )
    const terminal = await renderTerminal(42)
    terminal.onDataCallback?.('ignored')
    expect(invoke).not.toHaveBeenCalledWith('terminal:write', 'session-1', 42, 'ignored')
  })

  it('ignores a snapshot that resolves after unmount', async () => {
    let resolveSnapshot: ((value: unknown) => void) | undefined
    invoke.mockImplementation((channel: string) => {
      if (channel === 'terminal:snapshot') {
        return new Promise((resolve) => {
          resolveSnapshot = resolve
        })
      }
      return Promise.resolve({
        activeId: 42,
        sessionId: 'session-1',
        terminals: [{ id: 42, title: 'PowerShell', exitCode: null }]
      })
    })
    const terminal = await renderTerminal(42)
    act(() => root.unmount())
    resolveSnapshot?.({ data: 'late', cols: 120, rows: 40, seq: 10 })
    await act(() => Promise.resolve())

    expect(terminal.resize).not.toHaveBeenCalled()
    expect(terminal.write).not.toHaveBeenCalledWith('late', expect.any(Function))
    root = createRoot(container)
  })

  it('disposes xterm when the workbench switches views', async () => {
    const terminal = await renderTerminal()
    act(() => root.unmount())
    expect(terminal.dispose).toHaveBeenCalledOnce()
    root = createRoot(container)
  })
})
