/* eslint-disable @typescript-eslint/no-empty-function */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createWebContents: null as unknown as () => {
    backgroundThrottlingCalls: boolean[]
    debugger: { commands: Array<{ method: string; params?: unknown }> }
    windowOpenHandler?: (details: { url: string }) => { action: string }
  },
  views: [] as Array<{
    visibleCalls: boolean[]
    boundsCalls: unknown[]
    operations: string[]
    parent: unknown
  }>
}))

vi.mock('electron', () => {
  class FakeWebContents {
    url = 'about:blank'
    closed = false
    backgroundThrottlingCalls: boolean[] = []
    windowOpenHandler?: (details: { url: string }) => { action: string }
    listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    debugger = new (class {
      attached = false
      commands: Array<{ method: string; params?: unknown }> = []
      listeners = new Map<string, (...args: unknown[]) => void>()
      isAttached = (): boolean => this.attached
      attach = (): void => {
        this.attached = true
      }
      detach = (): void => {
        this.attached = false
      }
      on = (event: string, listener: (...args: unknown[]) => void): void => {
        this.listeners.set(event, listener)
      }
      off = (): void => {}
      sendCommand = async (method: string, params?: unknown): Promise<object> => {
        this.commands.push({ method, params })
        return {}
      }
      emitMessage = (method: string, params: unknown): void => {
        this.listeners.get('message')?.({}, method, params)
      }
    })()
    on(event: string, listener: (...args: unknown[]) => void): void {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
    }
    once(event: string, listener: (...args: unknown[]) => void): void {
      const once = (...args: unknown[]): void => {
        this.off(event, once)
        listener(...args)
      }
      this.on(event, once)
    }
    off(event: string, listener: (...args: unknown[]) => void): void {
      this.listeners.get(event)?.delete(listener)
    }
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
      this.windowOpenHandler = handler
    }
    loadURL(url: string): Promise<void> {
      this.url = url
      return Promise.resolve()
    }
    getURL(): string {
      return this.url
    }
    getTitle(): string {
      return ''
    }
    isLoading(): boolean {
      return false
    }
    reload(): void {}
    invalidate(): void {}
    setBackgroundThrottling(value: boolean): void {
      this.backgroundThrottlingCalls.push(value)
    }
    isDestroyed(): boolean {
      return this.closed
    }
    close(): void {
      this.closed = true
      for (const listener of [...(this.listeners.get('destroyed') ?? [])]) listener()
    }
    navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack(): void {},
      goForward(): void {}
    }
  }

  class WebContentsView {
    webContents = new FakeWebContents()
    visibleCalls: boolean[] = []
    boundsCalls: unknown[] = []
    operations: string[] = []
    parent: unknown = null
    constructor() {
      h.views.push(this)
    }
    setVisible(value: boolean): void {
      this.visibleCalls.push(value)
      this.operations.push(`visible:${value}`)
    }
    setBounds(bounds: unknown): void {
      this.boundsCalls.push(bounds)
      this.operations.push('bounds')
    }
  }

  h.createWebContents = () => new FakeWebContents()

  class BrowserWindow {}

  return { BrowserWindow, WebContentsView }
})

import { BrowserTabManager } from '../../../../src/extensions/browser/main/tab-manager'

describe('BrowserTabManager', () => {
  beforeEach(() => {
    h.views.length = 0
  })

  it('creates deferred tabs in order without allocating native views', () => {
    const manager = new BrowserTabManager()
    expect(manager.createTab(1)).toBe(1)
    expect(manager.createTab(2)).toBe(2)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([1, 2])
    expect(h.views).toHaveLength(0)
  })

  it('does not replace an existing tab with a duplicate resource id', () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const original = manager.get(1)

    expect(() => manager.createTab(1)).toThrow('browser tab already exists')
    expect(manager.get(1)).toBe(original)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([1])
  })

  it('applies the app color scheme to attached tabs and updates open pages', async () => {
    const manager = new BrowserTabManager(() => {}, 'dark')
    manager.createTab(1)
    const contents = h.createWebContents()

    manager.attach(1, contents as never)
    await vi.waitFor(() => {
      expect(contents.debugger.commands).toContainEqual({
        method: 'Emulation.setEmulatedMedia',
        params: { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }
      })
      expect(contents.debugger.commands).toContainEqual({
        method: 'Emulation.setAutoDarkModeOverride',
        params: { enabled: true }
      })
    })

    manager.setColorScheme('light')
    await vi.waitFor(() => {
      expect(contents.debugger.commands).toContainEqual({
        method: 'Emulation.setEmulatedMedia',
        params: { features: [{ name: 'prefers-color-scheme', value: 'light' }] }
      })
      expect(contents.debugger.commands).toContainEqual({
        method: 'Emulation.setAutoDarkModeOverride',
        params: { enabled: false }
      })
    })
  })

  it('attaches a renderer-owned webview guest without creating a native view', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const guest = h.createWebContents()

    manager.attach(1, guest as never)
    await manager.get(1)?.ready()

    expect(manager.get(1)?.webContents).toBe(guest)
    expect(h.views).toHaveLength(0)
    expect(guest.windowOpenHandler?.({ url: 'https://example.com' })).toEqual({ action: 'deny' })
  })

  it('reattaches automation when a renderer reload replaces a destroyed guest', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const first = h.createWebContents()
    manager.attach(1, first as never)
    await manager.get(1)?.ready()
    first.close()

    const replacement = h.createWebContents()
    manager.attach(1, replacement as never)
    await vi.waitFor(() => {
      expect(replacement.debugger.commands).toContainEqual({ method: 'Page.enable', params: undefined })
    })

    expect(manager.get(1)?.webContents).toBe(replacement)
  })

  it('waits for a replacement guest after the previous guest is destroyed', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const first = h.createWebContents()
    manager.attach(1, first as never)
    first.close()
    const operation = vi.fn(async () => undefined)

    const pending = manager.withUnthrottled(1, operation)
    await Promise.resolve()
    expect(operation).not.toHaveBeenCalled()

    manager.attach(1, h.createWebContents() as never)
    await pending
    expect(operation).toHaveBeenCalledOnce()
  })

  it('restores an active rendering lease on a replacement guest', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const first = h.createWebContents()
    manager.attach(1, first as never)
    const tab = manager.get(1)!
    await tab.acquireRendering()
    first.close()

    const replacement = h.createWebContents()
    manager.attach(1, replacement as never)
    await vi.waitFor(() => {
      expect(replacement.debugger.commands).toContainEqual({
        method: 'Emulation.setFocusEmulationEnabled',
        params: { enabled: true }
      })
    })

    await tab.releaseRendering()
    expect(replacement.debugger.commands).toContainEqual({
      method: 'Emulation.setFocusEmulationEnabled',
      params: { enabled: false }
    })
  })

  it('keeps a replacement guest unthrottled during an active operation', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const first = h.createWebContents()
    manager.attach(1, first as never)
    let finishOperation!: () => void
    const operation = manager.withUnthrottled(
      1,
      () => new Promise<void>((resolve) => { finishOperation = resolve })
    )
    await vi.waitFor(() => expect(finishOperation).toBeTypeOf('function'))
    first.close()

    const replacement = h.createWebContents()
    manager.attach(1, replacement as never)

    expect(replacement.backgroundThrottlingCalls).toEqual([false])
    finishOperation()
    await operation
    expect(replacement.backgroundThrottlingCalls).toEqual([false, true])
  })

  it('keeps a replacement guest unthrottled while it is being recorded', () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const first = h.createWebContents()
    manager.attach(1, first as never)
    manager.setRecording(1)
    first.close()

    const replacement = h.createWebContents()
    manager.attach(1, replacement as never)

    expect(replacement.backgroundThrottlingCalls).toEqual([false])
    manager.setRecording(null)
    expect(replacement.backgroundThrottlingCalls).toEqual([false, true])
  })

  it('temporarily focuses and unthrottles a hidden webview for rendered operations', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const guest = h.createWebContents()
    manager.attach(1, guest as never)

    await manager.withRendered(1, async () => {})

    expect(guest.backgroundThrottlingCalls).toEqual([true, false, true])
    expect(guest.debugger.commands).toEqual(
      expect.arrayContaining([
        { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } },
        { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: false } }
      ])
    )
  })

  it('keeps focus emulation enabled across concurrent rendered operations', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const guest = h.createWebContents()
    manager.attach(1, guest as never)
    let finishFirst!: () => void
    let finishSecond!: () => void
    const first = manager.withRendered(1, () => new Promise<void>((resolve) => {
      finishFirst = resolve
    }))
    const second = manager.withRendered(1, () => new Promise<void>((resolve) => {
      finishSecond = resolve
    }))
    await vi.waitFor(() => {
      expect(finishFirst).toBeTypeOf('function')
      expect(finishSecond).toBeTypeOf('function')
    })

    finishFirst()
    await first
    expect(
      guest.debugger.commands.filter(
        ({ method, params }) =>
          method === 'Emulation.setFocusEmulationEnabled' &&
          (params as { enabled?: boolean })?.enabled === false
      )
    ).toHaveLength(0)

    finishSecond()
    await second
    expect(
      guest.debugger.commands.filter(
        ({ method, params }) =>
          method === 'Emulation.setFocusEmulationEnabled' &&
          (params as { enabled?: boolean })?.enabled === false
      )
    ).toHaveLength(1)
  })

  it('stays unthrottled until both recording and activity leases are released', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    const guest = h.createWebContents()
    manager.attach(id, guest as never)
    manager.setRecording(id)
    let finishOperation!: () => void
    const operation = manager.withUnthrottled(
      id,
      () => new Promise<void>((resolve) => { finishOperation = resolve })
    )
    await vi.waitFor(() => expect(finishOperation).toBeTypeOf('function'))

    manager.setRecording(null)
    expect(guest.backgroundThrottlingCalls.at(-1)).toBe(false)
    finishOperation()
    await operation

    expect(guest.backgroundThrottlingCalls.at(-1)).toBe(true)
  })

  it('does not start an operation that becomes ready after teardown', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const guest = h.createWebContents()
    manager.attach(id, guest as never)
    let finishReady!: () => void
    vi.spyOn(tab, 'ready').mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishReady = resolve })
    )
    const operation = vi.fn(async () => undefined)
    const pending = manager.withUnthrottled(id, operation)
    await vi.waitFor(() => expect(finishReady).toBeTypeOf('function'))

    await manager.destroy()
    finishReady()

    await expect(pending).rejects.toThrow('browser tab manager is destroyed')
    expect(operation).not.toHaveBeenCalled()
  })

  it('does not let an old release disable a newly acquired rendering lease', async () => {
    const manager = new BrowserTabManager()
    manager.createTab(1)
    const guest = h.createWebContents()
    manager.attach(1, guest as never)
    const tab = manager.get(1)!
    await tab.acquireRendering()

    const releasing = tab.releaseRendering()
    const acquiring = tab.acquireRendering()
    await Promise.all([releasing, acquiring])

    const focusCommands = guest.debugger.commands.filter(
      ({ method }) => method === 'Emulation.setFocusEmulationEnabled'
    )
    expect(focusCommands.at(-1)?.params).toEqual({ enabled: true })
    await tab.releaseRendering()
  })

  it('exposes a requested URL immediately when creating a tab with a URL', () => {
    const manager = new BrowserTabManager()
    expect(manager.createTab(1, 'example.com')).toBe(1)

    expect(manager.state().tabs[0]).toMatchObject({
      id: 1,
      url: 'https://example.com',
      loading: true
    })
  })

  it('emits state immediately when creating a tab with a URL', () => {
    const manager = new BrowserTabManager()
    const changes: unknown[] = []
    manager.bindChange((state) => changes.push(state))

    manager.createTab(1, 'example.com')

    expect(changes.at(-1)).toMatchObject({
      tabs: [{ id: 1, url: 'https://example.com' }]
    })
  })

  it('preserves tab order when closing a tab', async () => {
    const manager = new BrowserTabManager()
    const a = manager.createTab(1)
    const b = manager.createTab(2)
    const c = manager.createTab(3)
    await manager.close(b)
    expect(manager.state().tabs.map((tab) => tab.id)).toEqual([a, c])
  })

  it('keeps temporary tabs out of UI state and destroys them after use', async () => {
    const manager = new BrowserTabManager()
    const changes: unknown[] = []
    manager.bindChange((state) => changes.push(state))
    let temporaryTab: import('../../../../src/extensions/browser/main/tab').BrowserTab | undefined

    const value = await manager.withTemporaryTab('https://example.com', async (tab) => {
      temporaryTab = tab
      expect(tab.id).toBe(-1)
      expect(
        (tab.view.webContents as unknown as { backgroundThrottlingCalls: boolean[] })
          .backgroundThrottlingCalls
      ).toEqual([false])
      expect(manager.state()).toEqual({ tabs: [] })
      expect((tab.view as unknown as { parent: unknown }).parent).toBeNull()
      return 42
    })

    expect(value).toBe(42)
    expect(changes).toEqual([])
    expect(temporaryTab?.view.webContents.close).toBeDefined()
    expect((temporaryTab?.view.webContents as unknown as { closed: boolean }).closed).toBe(true)
    expect(manager.createTab(1)).toBe(1)
  })

  it('rejects an invalid temporary-tab URL and still destroys the tab', async () => {
    const manager = new BrowserTabManager()
    const callback = vi.fn(async () => undefined)

    await expect(manager.withTemporaryTab('not a valid url', callback)).rejects.toThrow(
      'invalid url'
    )

    expect(callback).not.toHaveBeenCalled()
    expect(
      (h.views.at(-1) as unknown as { webContents: { closed: boolean } }).webContents.closed
    ).toBe(true)
    expect(manager.state()).toEqual({ tabs: [] })
  })

  it('destroys and rejects an in-flight temporary tab when the manager is destroyed', async () => {
    const manager = new BrowserTabManager()
    let callbackStarted!: () => void
    const started = new Promise<void>((resolve) => {
      callbackStarted = resolve
    })
    const operation = manager.withTemporaryTab('https://example.com', async () => {
      callbackStarted()
      await new Promise<void>(() => {})
    })
    await started
    const temporaryView = h.views[0] as {
      webContents: { closed: boolean }
    }

    await manager.destroy()

    await expect(operation).rejects.toThrow('browser tab manager was destroyed')
    expect(temporaryView.webContents.closed).toBe(true)
  })

  it('stops a recording before destroying its tab', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    const stopIfRecordingTab = vi.fn(async () => undefined)
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = stopIfRecordingTab

    await manager.close(id)

    expect(stopIfRecordingTab).toHaveBeenCalledWith(id)
    expect(manager.state().tabs).toEqual([])
  })

  it('still closes a tab when stopping its recording fails', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const guest = h.createWebContents()
    manager.attach(id, guest as never)
    const destroy = vi.spyOn(tab, 'destroy')
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = vi.fn(async () => {
      throw new Error('failed to write recording')
    })

    await expect(manager.close(id)).resolves.toBeUndefined()

    expect(destroy).toHaveBeenCalledOnce()
    expect(manager.state()).toEqual({ tabs: [] })
  })

  it('drops the activity lease when a tab closes during an operation', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    manager.attach(id, h.createWebContents() as never)
    let finishOperation!: () => void
    const operation = manager.withUnthrottled(
      id,
      () => new Promise<void>((resolve) => { finishOperation = resolve })
    )
    await vi.waitFor(() => expect(finishOperation).toBeTypeOf('function'))

    await manager.close(id)

    expect(
      (manager as unknown as { activityLeases: Map<number, number> }).activityLeases.has(id)
    ).toBe(false)
    finishOperation()
    await operation
  })

  it('coalesces concurrent closes of the same tab', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const guest = h.createWebContents()
    manager.attach(id, guest as never)
    const destroy = vi.spyOn(tab, 'destroy')
    let finishStop!: () => void
    const stopIfRecordingTab = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve
        })
    )
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = stopIfRecordingTab

    const first = manager.close(id)
    const second = manager.close(id)
    expect(manager.get(id)).toBeUndefined()
    const navigate = vi.spyOn(tab, 'navigate')
    expect(manager.navigate(id, 'https://example.com')).toBe(false)
    manager.goBack(id)
    manager.goForward(id)
    manager.reload(id)
    expect(navigate).not.toHaveBeenCalled()
    guest.close()
    expect(() => manager.attach(id, h.createWebContents() as never)).toThrow(
      'browser tab not found'
    )
    await expect(manager.withRendered(id, async () => undefined)).rejects.toThrow(
      'browser tab not found'
    )
    finishStop()
    await Promise.all([first, second])

    expect(stopIfRecordingTab).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('waits for an in-progress close before destroying the manager', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const destroyTab = vi.spyOn(tab, 'destroy')
    let finishStop!: () => void
    ;(
      manager as unknown as {
        recorder: { stopIfRecordingTab: (tabId: number) => Promise<void> }
      }
    ).recorder.stopIfRecordingTab = () =>
      new Promise<void>((resolve) => {
        finishStop = resolve
      })

    const closing = manager.close(id)
    const destroying = manager.destroy()
    await Promise.resolve()
    expect(destroyTab).not.toHaveBeenCalled()

    finishStop()
    await Promise.all([closing, destroying])
    expect(destroyTab).toHaveBeenCalledOnce()
  })

  it('makes destroy idempotent and rejects new tabs after teardown starts', async () => {
    const manager = new BrowserTabManager()
    const id = manager.createTab(1)
    const tab = manager.get(id)!
    const guest = h.createWebContents()
    manager.attach(id, guest as never)
    const destroyTab = vi.spyOn(tab, 'destroy')
    let finishRecorderDestroy!: () => void
    const destroyRecorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRecorderDestroy = resolve
        })
    )
    ;(manager as unknown as { recorder: { destroy: () => Promise<void> } }).recorder.destroy =
      destroyRecorder

    const first = manager.destroy()
    const second = manager.destroy()
    expect(second).toBe(first)
    expect(() => manager.createTab(2)).toThrow('browser tab manager is destroyed')
    expect(() => manager.attach(id, h.createWebContents() as never)).toThrow(
      'browser tab manager is destroyed'
    )
    await expect(manager.withRendered(id, async () => undefined)).rejects.toThrow(
      'browser tab manager is destroyed'
    )
    expect(manager.close(id)).toBe(first)

    const windowOpen = guest.windowOpenHandler!
    expect(windowOpen({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(manager.state().tabs).toHaveLength(1)

    await vi.waitFor(() => expect(finishRecorderDestroy).toBeTypeOf('function'))
    finishRecorderDestroy()
    await first
    expect(destroyRecorder).toHaveBeenCalledOnce()
    expect(destroyTab).toHaveBeenCalledOnce()
  })

  it('destroys tabs when recorder cleanup fails', async () => {
    const manager = new BrowserTabManager()
    const tab = manager.get(manager.createTab(1))!
    const destroyTab = vi.spyOn(tab, 'destroy')
    ;(manager as unknown as { recorder: { destroy: () => Promise<void> } }).recorder.destroy = () =>
      Promise.reject(new Error('recorder cleanup failed'))

    await expect(manager.destroy()).rejects.toThrow('recorder cleanup failed')
    expect(destroyTab).toHaveBeenCalledOnce()
    expect(manager.state().tabs).toEqual([])
  })
})
