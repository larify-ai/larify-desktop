import { beforeEach, describe, expect, it, vi } from 'vitest'

const browser = vi.hoisted(() => {
  const instances: MockTab[] = []

  class MockTab {
    constructor(
      readonly id: number,
      readonly partition: string,
      readonly options: { automation?: boolean }
    ) {
      instances.push(this)
    }

    destroy = vi.fn()
    navigate = vi.fn()
    listeners = new Set<() => void>()
    view = {
      setBackgroundColor: vi.fn(),
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        insertCSS: vi.fn(async () => 'css-key'),
        off: vi.fn((_event: string, listener: () => void) => this.listeners.delete(listener)),
        on: vi.fn((_event: string, listener: () => void) => this.listeners.add(listener)),
        setWindowOpenHandler: vi.fn()
      }
    }

    finishLoad(): void {
      for (const listener of [...this.listeners]) listener()
    }
  }

  return { instances, MockTab }
})

vi.mock('../../../../src/extensions/browser/main/tab', () => ({ BrowserTab: browser.MockTab }))

import { NativePreviewManager } from '../../../../src/extensions/workspace/main/native-preview-manager'

const createWindow = (): {
  contentView: {
    addChildView: ReturnType<typeof vi.fn>
    removeChildView: ReturnType<typeof vi.fn>
  }
} => ({
  contentView: {
    addChildView: vi.fn(),
    removeChildView: vi.fn()
  }
})

describe('NativePreviewManager', () => {
  beforeEach(() => {
    browser.instances.length = 0
    vi.clearAllMocks()
  })

  it('shows a preview only after it has visible bounds', () => {
    const window = createWindow()
    const manager = new NativePreviewManager(window as never)
    const bounds = { x: 10, y: 20, width: 300, height: 200 }

    manager.open(1, 'D:\\workspace\\file.pdf', 'application/pdf', '#111', bounds, true)

    const tab = browser.instances[0]
    expect(tab).toMatchObject({
      id: 1,
      options: { automation: false },
      partition: 'persist:larify-browser'
    })
    expect(window.contentView.addChildView).toHaveBeenCalledWith(tab.view)
    expect(tab.view.setVisible).toHaveBeenNthCalledWith(1, false)
    expect(tab.view.setBounds).toHaveBeenCalledWith(bounds)
    expect(tab.view.setVisible).toHaveBeenLastCalledWith(true)
    expect(tab.view.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
      tab.navigate.mock.invocationCallOrder[0]
    )
  })

  it('deduplicates bounds across live and committed updates', () => {
    const manager = new NativePreviewManager(createWindow() as never)
    const bounds = { x: 1, y: 2, width: 300, height: 200 }
    manager.open(1, 'D:\\workspace\\file.pdf', 'application/pdf', '#111')
    manager.setVisible(1, true)

    manager.setBounds(1, bounds)
    manager.setBounds(1, { ...bounds })

    expect(browser.instances[0].view.setBounds).toHaveBeenCalledOnce()
  })

  it('keeps only the selected preview visible', () => {
    const manager = new NativePreviewManager(createWindow() as never)
    manager.open(1, 'D:\\workspace\\first.pdf', 'application/pdf', '#111')
    manager.open(2, 'D:\\workspace\\second.pdf', 'application/pdf', '#111')
    manager.setBounds(1, { x: 0, y: 0, width: 100, height: 100 })
    manager.setBounds(2, { x: 0, y: 0, width: 100, height: 100 })

    manager.setVisible(1, true)
    manager.setVisible(2, true)

    expect(browser.instances[0].view.setVisible).toHaveBeenLastCalledWith(false)
    expect(browser.instances[1].view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('updates a PDF background without reloading the document', () => {
    const manager = new NativePreviewManager(createWindow() as never)
    manager.open(1, 'D:\\workspace\\file.pdf', 'application/pdf', '#111')

    manager.open(1, 'D:\\workspace\\file.pdf', 'application/pdf', '#222')

    const tab = browser.instances[0]
    expect(tab.view.setBackgroundColor).toHaveBeenLastCalledWith('#222')
    expect(tab.navigate).toHaveBeenCalledOnce()
  })

  it('uses the browser default white canvas for HTML previews', () => {
    const manager = new NativePreviewManager(createWindow() as never)

    manager.open(1, 'D:\\workspace\\page.html', 'text/html', '#111')
    manager.open(1, 'D:\\workspace\\page.html', 'text/html', '#222')

    const tab = browser.instances[0]
    expect(tab.view.setBackgroundColor).toHaveBeenLastCalledWith('#fff')
    expect(tab.navigate).toHaveBeenCalledOnce()
  })

  it('reloads an image to apply a changed page background', () => {
    const manager = new NativePreviewManager(createWindow() as never)
    manager.open(1, 'D:\\workspace\\image.png', 'image/png', '#111')

    manager.open(1, 'D:\\workspace\\image.png', 'image/png', '#222')
    browser.instances[0].finishLoad()

    const tab = browser.instances[0]
    expect(tab.navigate).toHaveBeenCalledTimes(2)
    expect(tab.view.webContents.insertCSS).toHaveBeenCalledOnce()
    expect(tab.view.webContents.insertCSS).toHaveBeenCalledWith(expect.stringContaining('#222'))
  })

  it('does not reveal an image before its fitted layout is ready', async () => {
    const manager = new NativePreviewManager(createWindow() as never)
    const bounds = { x: 0, y: 0, width: 300, height: 200 }

    manager.open(1, 'D:\\workspace\\image.png', 'image/png', '#111', bounds, true)

    const tab = browser.instances[0]
    expect(tab.view.setVisible).not.toHaveBeenCalledWith(true)

    tab.finishLoad()
    await vi.waitFor(() => expect(tab.view.setVisible).toHaveBeenLastCalledWith(true))
    expect(tab.view.webContents.insertCSS.mock.invocationCallOrder[0]).toBeLessThan(
      tab.view.setVisible.mock.invocationCallOrder.at(-1)!
    )
  })

  it('ignores stale style callbacks when navigation returns to the same path', () => {
    const manager = new NativePreviewManager(createWindow() as never)
    manager.open(1, 'D:\\workspace\\image.png', 'image/png', '#111')
    manager.open(1, 'D:\\workspace\\other.pdf', 'application/pdf', '#222')
    manager.open(1, 'D:\\workspace\\image.png', 'image/png', '#333')

    browser.instances[0].finishLoad()

    const insertCSS = browser.instances[0].view.webContents.insertCSS
    expect(insertCSS).toHaveBeenCalledOnce()
    expect(insertCSS).toHaveBeenCalledWith(expect.stringContaining('#333'))
  })

  it('closes previews and disposes all remaining tabs', () => {
    const window = createWindow()
    const manager = new NativePreviewManager(window as never)
    manager.open(1, 'D:\\workspace\\first.pdf', 'application/pdf', '#111')
    manager.open(2, 'D:\\workspace\\second.pdf', 'application/pdf', '#111')

    manager.close(1)
    manager.dispose()

    expect(window.contentView.removeChildView).toHaveBeenCalledTimes(2)
    expect(browser.instances[0].destroy).toHaveBeenCalledOnce()
    expect(browser.instances[1].destroy).toHaveBeenCalledOnce()
  })
})
