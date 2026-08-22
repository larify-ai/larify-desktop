import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceManager } from '../../../../src/main/core/resource'
import type { BrowserState } from '../../../../src/extensions/browser/shared/types'

const h = vi.hoisted(() => ({
  managers: [] as Array<{
    tabs: Map<number, unknown>
    createTab: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    setActive: ReturnType<typeof vi.fn>
    setBounds: ReturnType<typeof vi.fn>
    setVisible: ReturnType<typeof vi.fn>
    setRecording: ReturnType<typeof vi.fn>
    withRendered: ReturnType<typeof vi.fn>
    withUnthrottled: ReturnType<typeof vi.fn>
    recordStart: ReturnType<typeof vi.fn>
    recordStop: ReturnType<typeof vi.fn>
    recordStopIfCurrent: ReturnType<typeof vi.fn>
    recordRestart: ReturnType<typeof vi.fn>
    navigate: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    openTab(url?: string): void
    emit(state: BrowserState): void
  }>
}))

vi.mock('../../../../src/extensions/browser/main/tab-manager', () => ({
  BROWSER_PARTITION: 'persist:test',
  BrowserTabManager: class {
    tabs = new Map<number, unknown>()
    activeId: number | null = null
    createTab = vi.fn((id: number, url?: string, activate = true) => {
      if (url === 'fail:') throw new Error('open failed')
      const tab = { id, state: () => ({ id, title: `Page ${id}` }) }
      this.tabs.set(id, tab)
      if (activate) this.activeId = id
      return tab
    })
    get = (id: number): unknown => this.tabs.get(id)
    isActive = (id: number): boolean => this.activeId === id
    close = vi.fn(async (id: number) => {
      this.tabs.delete(id)
    })
    state = (): { tabs: unknown[]; activeId: number | null } => ({
      tabs: [...this.tabs.values()].map((tab) => (tab as { state(): unknown }).state()),
      activeId: this.activeId
    })
    onChange?: (state: BrowserState) => void
    bindChange = vi.fn((callback: (state: BrowserState) => void) => {
      this.onChange = callback
    })
    setActive = vi.fn((id: number) => {
      if (this.tabs.has(id)) this.activeId = id
    })
    setBounds = vi.fn()
    setVisible = vi.fn()
    setRecording = vi.fn()
    withRendered = vi.fn(async (_id: number, operation: () => Promise<unknown>) => operation())
    withUnthrottled = vi.fn(async (_id: number, operation: () => Promise<unknown>) => operation())
    recordStart = vi.fn(async () => 1)
    recordStop = vi.fn(async () => ({ path: 'recording.webm', bytes: 1 }))
    recordStopIfCurrent = vi.fn(async () => ({ path: 'recording.webm', bytes: 1 }))
    recordRestart = vi.fn(async () => 2)
    navigate = vi.fn(() => true)
    goBack = vi.fn()
    goForward = vi.fn()
    reload = vi.fn()
    destroy = vi.fn()
    emit = (state: BrowserState): void => {
      this.onChange?.(state)
    }
    constructor(
      _window: unknown,
      private readonly requestOpen: (url?: string) => void
    ) {
      h.managers.push(this)
    }
    openTab = (url?: string): void => this.requestOpen(url)
  }
}))

import { BrowserService } from '../../../../src/extensions/browser/main/browser-service'

describe('BrowserService resources', () => {
  beforeEach(() => h.managers.splice(0))

  it('uses globally allocated resource ids across sessions', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    expect(service.createTab('session-a')).toBe(1)
    expect(service.createTab('session-b', 'https://example.com')).toBe(2)
    expect(resources.list()).toEqual([
      { id: 1, type: 'browser', sessionId: 'session-a' },
      { id: 2, type: 'browser', sessionId: 'session-b' }
    ])
    expect(h.managers[0].createTab).toHaveBeenCalledWith(1, undefined, false)
    expect(h.managers[1].createTab).toHaveBeenCalledWith(2, 'https://example.com', false)
  })

  it('does not retain a resource or manager when opening fails', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)

    expect(() => service.createTab('session-a', 'fail:')).toThrow('open failed')

    expect(resources.list()).toEqual([])
    expect(h.managers[0].destroy).toHaveBeenCalledOnce()
    expect(service.state('session-a')).toEqual({ tabs: [], activeId: null })
  })

  it('closes the native tab through ResourceManager', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.close('session-a', id)
    expect(resources.get(id)).toBeUndefined()
    expect(h.managers[0].close).toHaveBeenCalledWith(id)
    expect(h.managers[0].destroy).not.toHaveBeenCalled()
  })

  it('delegates render and activity leases to the owning session manager', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')

    await expect(service.withRendered('session-a', id, async () => 'rendered')).resolves.toBe(
      'rendered'
    )
    await expect(service.withUnthrottled('session-a', id, async () => 'active')).resolves.toBe(
      'active'
    )
    expect(h.managers[0].withRendered).toHaveBeenCalledWith(id, expect.any(Function))
    expect(h.managers[0].withUnthrottled).toHaveBeenCalledWith(id, expect.any(Function))
  })

  it('hides the native view when its visible resource closes', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    service.setVisible('session-a', id, true)
    h.managers[0].setVisible.mockClear()

    await resources.close(id)

    expect(h.managers[0].setVisible).toHaveBeenCalledOnce()
    expect(h.managers[0].setVisible).toHaveBeenCalledWith(false)
  })

  it('does not hide a newer resource when an older resource closes', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const old = service.createTab('session-a')
    const current = service.createTab('session-a')
    service.setVisible('session-a', old, true)
    service.setVisible('session-a', current, true)
    h.managers[0].setVisible.mockClear()

    await resources.close(old)

    expect(h.managers[0].setVisible).not.toHaveBeenCalled()
  })

  it('hides the native view when closing its visible resource fails', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    service.setVisible('session-a', id, true)
    h.managers[0].setVisible.mockClear()
    h.managers[0].close.mockRejectedValueOnce(new Error('close failed'))

    await expect(resources.close(id)).rejects.toThrow('close failed')

    expect(h.managers[0].setVisible).toHaveBeenCalledWith(false)
  })

  it('updates the state after closing a tab', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    await service.close('session-a', first)
    expect(service.state('session-a')).toEqual({
      tabs: [{ id: second, title: `Page ${second}` }],
      activeId: null
    })
  })

  it('selects a resource before showing its native view', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')
    service.setVisible('session-a', id, true)
    service.setBounds('session-a', id, { x: 1, y: 2, width: 3, height: 4 })
    expect(h.managers[0].setActive).toHaveBeenCalledWith(id)
    expect(h.managers[0].setBounds).toHaveBeenCalledWith(
      { x: 1, y: 2, width: 3, height: 4 },
      false
    )
    expect(h.managers[0].setVisible).toHaveBeenCalledWith(true)
    expect(h.managers[0].setVisible).toHaveBeenCalledTimes(1)
  })

  it('does not lay out an already visible resource again', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')
    service.setVisible('session-a', id, true)
    h.managers[0].setActive.mockClear()
    h.managers[0].setVisible.mockClear()

    service.setVisible('session-a', id, true)

    expect(h.managers[0].setActive).not.toHaveBeenCalled()
    expect(h.managers[0].setVisible).not.toHaveBeenCalled()
  })

  it('does not hide the visible view when a background tab is created', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    service.setVisible('session-a', first, true)
    const second = service.createTab('session-a')
    h.managers[0].setVisible.mockClear()

    service.setVisible('session-a', second, false)

    expect(h.managers[0].setVisible).not.toHaveBeenCalled()
  })

  it('switches visible resources in one session without toggling the native view', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-a')
    service.setVisible('session-a', first, true)
    h.managers[0].setActive.mockClear()
    h.managers[0].setVisible.mockClear()

    service.setVisible('session-a', second, true)

    expect(h.managers[0].setActive).toHaveBeenCalledOnce()
    expect(h.managers[0].setActive).toHaveBeenCalledWith(second)
    expect(h.managers[0].setVisible).not.toHaveBeenCalled()
  })

  it('does not change the active tab when receiving stale bounds', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const stale = service.createTab('session-a')
    const active = service.createTab('session-a')
    service.setVisible('session-a', active, true)
    h.managers[0].setActive.mockClear()

    const updated = service.setBounds('session-a', stale, { x: 1, y: 2, width: 3, height: 4 })

    expect(h.managers[0].setActive).not.toHaveBeenCalled()
    expect(h.managers[0].setBounds).not.toHaveBeenCalled()
    expect(h.managers[0].activeId).toBe(active)
    expect(updated).toBe(false)
  })

  it('activates the visible viewport before applying its first bounds', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')

    const updated = service.setBounds(
      'session-a',
      id,
      { x: 1, y: 2, width: 3, height: 4 },
      false,
      true
    )

    expect(h.managers[0].setActive).toHaveBeenCalledWith(id)
    expect(h.managers[0].setBounds).toHaveBeenCalledWith(
      { x: 1, y: 2, width: 3, height: 4 },
      false
    )
    expect(h.managers[0].setActive.mock.invocationCallOrder[0]).toBeLessThan(
      h.managers[0].setBounds.mock.invocationCallOrder[0]
    )
    expect(updated).toBe(true)
  })

  it('requests workbench selection only for a user-opened popup', () => {
    const send = vi.fn()
    const service = new BrowserService(
      { webContents: { send } } as unknown as import('electron').BrowserWindow,
      new ResourceManager()
    )

    const background = service.createTab('session-a', 'https://agent.example')
    expect(send).not.toHaveBeenCalled()

    h.managers[0].openTab('https://user.example')

    expect(send).toHaveBeenCalledWith('resource:select', {
      rendererId: 'browser',
      resourceId: background + 1,
      sessionId: 'session-a'
    })
    expect(h.managers[0].activeId).toBeNull()
  })

  it('shows only the requested session and hides only the requested session', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-b')
    service.setVisible('session-b', second, true)
    expect(h.managers[0].setVisible).toHaveBeenCalledWith(false)
    expect(h.managers[1].setVisible).toHaveBeenCalledWith(true)
    h.managers[1].setVisible.mockClear()
    service.setVisible('session-a', first, false)
    expect(h.managers[0].setVisible).toHaveBeenLastCalledWith(false)
    expect(h.managers[1].setVisible).not.toHaveBeenCalled()
  })

  it('lets the visible viewport hide its session after the manager active tab changes', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const visible = service.createTab('session-a')
    service.setVisible('session-a', visible, true)
    service.createTab('session-a')
    h.managers[0].setVisible.mockClear()

    service.setVisible('session-a', visible, false)

    expect(h.managers[0].setVisible).toHaveBeenCalledWith(false)
  })

  it('does not let an old viewport hide the current viewport', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const old = service.createTab('session-a')
    const current = service.createTab('session-a')
    service.setVisible('session-a', old, true)
    service.setVisible('session-a', current, true)
    h.managers[0].setVisible.mockClear()

    service.setVisible('session-a', old, false)

    expect(h.managers[0].setVisible).not.toHaveBeenCalled()
  })

  it('hides the visible resource through its owning session', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const visible = service.createTab('session-a')
    service.createTab('session-b')
    service.setVisible('session-a', visible, true)
    h.managers[0].setVisible.mockClear()
    h.managers[1].setVisible.mockClear()

    service.setVisible('session-b', visible, false)

    expect(h.managers[0].setVisible).toHaveBeenCalledWith(false)
    expect(h.managers[1].setVisible).not.toHaveBeenCalled()
  })

  it('emits state changes with the owning session id', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const listener = vi.fn()
    service.bindChange(listener)
    service.createTab('session-a')
    const state = { tabs: [{ id: 1 }], activeId: 1 } as BrowserState
    h.managers[0].emit(state)
    expect(listener).toHaveBeenCalledWith('session-a', state)
  })

  it('turns address-bar text into a search before navigating', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')
    expect(service.navigate('session-a', id, '小红书')).toBe(true)
    expect(h.managers[0].navigate).toHaveBeenCalledWith(
      id,
      'https://www.bing.com/search?q=%E5%B0%8F%E7%BA%A2%E4%B9%A6'
    )
  })

  it('removes every resource owned by a destroyed session', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    service.createTab('session-a')
    const other = service.createTab('session-b')
    await resources.destroy('session-a')
    expect(resources.list()).toEqual([{ id: other, type: 'browser', sessionId: 'session-b' }])
    expect(h.managers[0].destroy).toHaveBeenCalledOnce()
    expect(h.managers[1].destroy).not.toHaveBeenCalled()
  })

  it('can show a recreated session after its previous manager was destroyed', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const first = service.createTab('session-a')
    service.setVisible('session-a', first, true)

    await resources.destroy('session-a')
    const second = service.createTab('session-a')
    service.setVisible('session-a', second, true)

    expect(h.managers).toHaveLength(2)
    expect(h.managers[1].setVisible).toHaveBeenCalledOnce()
    expect(h.managers[1].setVisible).toHaveBeenCalledWith(true)
  })

  it('can show a recreated session after its previous manager fails to destroy', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const first = service.createTab('session-a')
    service.setVisible('session-a', first, true)
    h.managers[0].destroy.mockRejectedValueOnce(new Error('destroy failed'))

    await resources.destroy('session-a')
    const second = service.createTab('session-a')
    service.setVisible('session-a', second, true)

    expect(h.managers).toHaveLength(2)
    expect(h.managers[1].setVisible).toHaveBeenCalledWith(true)
  })

  it('rejects resources after global destruction starts', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    service.createTab('session-a')
    const destroying = service.destroy()
    expect(() => service.createTab('session-b')).toThrow()
    await destroying
    expect(() => service.createTab('session-b')).toThrow()
  })

  it('does not allocate resources when reading an unused session', () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    expect(resources.list()).toEqual([])
    expect(service.state('unused')).toEqual({ tabs: [], activeId: null })
    service.setVisible('unused', 1, true)
    expect(h.managers).toEqual([])
  })

  it('serializes recording globally without activating the recorded tab', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-b')
    const firstTab = service.tab('session-a', first)!
    const secondTab = service.tab('session-b', second)!

    const generation = await service.recordStart('session-a', firstTab, 'first.webm')

    expect(generation).toBe(1)
    expect(h.managers[0].setRecording).toHaveBeenCalledWith(first)
    expect(h.managers[0].setActive).not.toHaveBeenCalled()
    await expect(service.recordStart('session-b', secondTab, 'second.webm')).rejects.toThrow(
      'another browser recording is already in progress'
    )
    expect(h.managers[1].recordStart).not.toHaveBeenCalled()
    await expect(service.recordStop('session-b')).rejects.toThrow('no recording in progress')

    await service.recordStop('session-a')
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
    await expect(service.recordStart('session-b', secondTab, 'second.webm')).resolves.toBe(1)
  })

  it('releases the global recording claim when startup fails', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    const second = service.createTab('session-b')
    h.managers[0].recordStart.mockRejectedValueOnce(new Error('start failed'))

    await expect(
      service.recordStart('session-a', service.tab('session-a', first)!, 'first.webm')
    ).rejects.toThrow('start failed')
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
    await expect(
      service.recordStart('session-b', service.tab('session-b', second)!, 'second.webm')
    ).resolves.toBe(1)
  })

  it('does not let an older stop clear a replacement recording', async () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')
    const tab = service.tab('session-a', id)!
    let finishStop!: (value: { path: string; bytes: number }) => void
    h.managers[0].recordStop.mockImplementationOnce(
      () => new Promise((resolve) => { finishStop = resolve })
    )

    await service.recordStart('session-a', tab, 'first.webm')
    const stopping = service.recordStop('session-a')
    await vi.waitFor(() => expect(finishStop).toBeTypeOf('function'))
    await expect(service.recordRestart('session-a', tab, 'second.webm')).resolves.toBe(2)

    finishStop({ path: 'first.webm', bytes: 1 })
    await stopping
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(id)
    await expect(service.recordStopIfCurrent('session-a', 2)).resolves.toEqual({
      path: 'recording.webm',
      bytes: 1
    })
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
  })

  it('reports cancellation when a resource closes during recording startup', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    const tab = service.tab('session-a', id)!
    let finishStart!: (generation: number) => void
    let finishStop!: (value: { path: string; bytes: number }) => void
    h.managers[0].recordStart.mockImplementationOnce(
      () => new Promise((resolve) => { finishStart = resolve })
    )
    h.managers[0].recordStop.mockImplementationOnce(
      () => new Promise((resolve) => { finishStop = resolve })
    )

    const starting = service.recordStart('session-a', tab, 'first.webm')
    await vi.waitFor(() => expect(finishStart).toBeTypeOf('function'))
    const closing = resources.close(id)
    await vi.waitFor(() => expect(finishStop).toBeTypeOf('function'))

    finishStart(1)
    await expect(starting).rejects.toThrow('recording was cancelled during startup')
    await expect(service.recordStart('session-b', tab, 'other.webm')).rejects.toThrow(
      'another browser recording is already in progress'
    )
    finishStop({ path: 'first.webm', bytes: 1 })
    await closing
  })

  it('stops and releases a recording when its resource closes', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')

    await resources.close(id)

    expect(h.managers[0].recordStopIfCurrent).toHaveBeenCalledWith(1)
    expect(h.managers[0].setRecording).toHaveBeenLastCalledWith(null)
    await expect(service.recordStop('session-a')).rejects.toThrow('no recording in progress')
  })

  it('still closes a recorded tab when stopping the recording fails', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')
    h.managers[0].recordStopIfCurrent.mockRejectedValueOnce(new Error('recording write failed'))

    await expect(resources.close(id)).rejects.toThrow('recording write failed')

    expect(h.managers[0].close).toHaveBeenCalledWith(id)
    expect(service.tab('session-a', id)).toBeUndefined()
  })

  it('preserves both recording and tab close failures', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')
    h.managers[0].recordStopIfCurrent.mockRejectedValueOnce(new Error('recording write failed'))
    h.managers[0].close.mockRejectedValueOnce(new Error('tab close failed'))

    const error = await resources.close(id).catch((reason) => reason)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'recording write failed' }),
      expect.objectContaining({ message: 'tab close failed' })
    ])
  })

  it('destroys the session manager when recording cleanup fails', async () => {
    const resources = new ResourceManager()
    const service = new BrowserService({} as never, resources)
    const id = service.createTab('session-a')
    await service.recordStart('session-a', service.tab('session-a', id)!, 'first.webm')
    h.managers[0].recordStopIfCurrent.mockRejectedValueOnce(new Error('recording write failed'))

    await resources.destroy('session-a')

    expect(h.managers[0].close).toHaveBeenCalledWith(id)
    expect(h.managers[0].destroy).toHaveBeenCalledOnce()
  })
})
