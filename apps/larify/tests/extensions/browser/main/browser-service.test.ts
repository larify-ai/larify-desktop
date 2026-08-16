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
    navigate: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    emit(state: BrowserState): void
  }>
}))

vi.mock('../../../../src/extensions/browser/main/tab-manager', () => ({
  BROWSER_PARTITION: 'persist:test',
  BrowserTabManager: class {
    tabs = new Map<number, unknown>()
    activeId: number | null = null
    createTab = vi.fn((id: number, url?: string) => {
      if (url === 'fail:') throw new Error('open failed')
      const tab = { id, state: () => ({ id, title: `Page ${id}` }) }
      this.tabs.set(id, tab)
      this.activeId = id
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
    navigate = vi.fn(() => true)
    goBack = vi.fn()
    goForward = vi.fn()
    reload = vi.fn()
    destroy = vi.fn()
    emit = (state: BrowserState): void => {
      this.onChange?.(state)
    }
    constructor() {
      h.managers.push(this)
    }
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
    expect(h.managers[0].createTab).toHaveBeenCalledWith(1, undefined)
    expect(h.managers[1].createTab).toHaveBeenCalledWith(2, 'https://example.com')
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
      activeId: second
    })
  })

  it('selects a resource before showing its native view', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const id = service.createTab('session-a')
    service.setBounds('session-a', id, { x: 1, y: 2, width: 3, height: 4 })
    service.setVisible('session-a', id, true)
    expect(h.managers[0].setActive).toHaveBeenCalledWith(id)
    expect(h.managers[0].setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 3, height: 4 })
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

  it('hides a newly active blank tab even while the visible resource record is stale', () => {
    const service = new BrowserService({} as never, new ResourceManager())
    const first = service.createTab('session-a')
    service.setVisible('session-a', first, true)
    const second = service.createTab('session-a')
    h.managers[0].setVisible.mockClear()

    service.setVisible('session-a', second, false)

    expect(h.managers[0].setVisible).toHaveBeenCalledOnce()
    expect(h.managers[0].setVisible).toHaveBeenCalledWith(false)
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
    h.managers[0].setActive.mockClear()

    service.setBounds('session-a', stale, { x: 1, y: 2, width: 3, height: 4 })

    expect(h.managers[0].setActive).not.toHaveBeenCalled()
    expect(h.managers[0].setBounds).not.toHaveBeenCalled()
    expect(h.managers[0].activeId).toBe(active)
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
})
