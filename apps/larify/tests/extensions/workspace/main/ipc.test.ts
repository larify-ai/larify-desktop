import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
})

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }))

import { registerWorkspaceIpc } from '../../../../src/extensions/workspace/main/ipc'

interface TestSender {
  isDestroyed: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  destroy(): void
}

const createSender = (): TestSender => {
  const listeners = new Map<string, () => void>()
  return {
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (listeners.get(event) === listener) listeners.delete(event)
    }),
    send: vi.fn(),
    destroy: () => listeners.get('destroyed')?.()
  }
}

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(electron.handlers.get(channel)?.(...(args as never[])))

describe('workspace IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('deduplicates subscribers and stops broadcasting after a renderer is destroyed', async () => {
    let onChange!: (event: string, path: string) => void
    const service = {
      open: vi.fn(async (_root, listener) => {
        onChange = listener
        return 'D:\\workspace'
      })
    }
    const sender = createSender()
    const unregister = registerWorkspaceIpc(service as never)

    await invoke('workspace:open', { sender }, 'D:\\workspace')
    await invoke('workspace:open', { sender }, 'D:\\workspace')
    expect(sender.once).toHaveBeenCalledTimes(1)

    onChange('change', 'D:\\workspace\\file.ts')
    expect(sender.send).toHaveBeenCalledOnce()
    sender.destroy()
    onChange('change', 'D:\\workspace\\file.ts')
    expect(sender.send).toHaveBeenCalledOnce()

    unregister()
  })

  it('forwards editor commands and cleans live renderer listeners on unregister', async () => {
    const service = { open: vi.fn(async () => 'D:\\workspace') }
    const editor = { send: vi.fn() }
    const sender = createSender()
    const unregister = registerWorkspaceIpc(service as never, () => editor as never)
    const command = { type: 'theme', theme: 'dark' }

    await invoke('workspace:open', { sender }, 'D:\\workspace')
    await invoke('workspace-editor:command', { sender }, command)
    expect(editor.send).toHaveBeenCalledWith(command)

    unregister()
    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function))
    expect(electron.handlers.size).toBe(0)
  })

  it('maps missing optional files to null without hiding other errors', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    const service = {
      stat: vi.fn().mockRejectedValueOnce(missing).mockRejectedValueOnce(new Error('denied'))
    }
    const unregister = registerWorkspaceIpc(service as never)

    await expect(invoke('workspace:stat', {}, 'missing')).resolves.toBeNull()
    await expect(invoke('workspace:stat', {}, 'denied')).rejects.toThrow('denied')

    unregister()
  })
})
