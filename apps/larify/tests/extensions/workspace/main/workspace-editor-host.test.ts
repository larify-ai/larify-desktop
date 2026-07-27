import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  class WebContents {
    private readonly listeners = new Map<string, Set<() => void>>()
    close = vi.fn()
    isDestroyed = vi.fn(() => false)
    loadFile = vi.fn(async () => undefined)
    loadURL = vi.fn(async () => undefined)
    send = vi.fn()

    emit(event: string): void {
      this.listeners.get(event)?.forEach((listener) => listener())
    }

    on(event: string, listener: () => void): this {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    removeListener(event: string, listener: () => void): this {
      this.listeners.get(event)?.delete(listener)
      return this
    }
  }

  class WebContentsView {
    readonly webContents = new WebContents()
    setBackgroundColor = vi.fn()
    setBounds = vi.fn()
    setVisible = vi.fn()
  }

  return { WebContentsView }
})

vi.mock('electron', () => electron)
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { WorkspaceEditorHost } from '../../../../src/extensions/workspace/main/workspace-editor-host'

describe('WorkspaceEditorHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queues commands until ready and queues them again after a renderer reload', async () => {
    const window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn()
      }
    }
    const host = new WorkspaceEditorHost(window as never)
    const contents = host.view.webContents
    expect(host.view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1, height: 1 })
    host.setBounds({ x: 10, y: 20, width: 0, height: 0 })
    expect(host.view.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 1, height: 1 })
    const prepare = { type: 'prepare', root: 'D:\\workspace' } as const
    const open = { type: 'open', root: 'D:\\workspace', file: 'D:\\workspace\\index.ts' } as const
    const theme = { type: 'theme', theme: 'dark' } as const

    host.send(prepare)
    expect(contents.send).not.toHaveBeenCalled()
    expect(host.markReady()).toEqual([prepare])

    host.send(open)
    expect(contents.send).toHaveBeenCalledWith('workspace-editor:command', open)

    contents.emit('did-start-loading')
    host.send(theme)
    expect(contents.send).toHaveBeenCalledTimes(1)
    expect(host.markReady()).toEqual([open, theme])

    host.destroy()
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(host.view)
    expect(contents.close).toHaveBeenCalled()
  })
})
