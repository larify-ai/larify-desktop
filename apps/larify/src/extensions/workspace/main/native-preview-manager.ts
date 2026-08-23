import { pathToFileURL } from 'node:url'
import { type BrowserWindow, type Rectangle } from 'electron'
import { BrowserTab } from '../../browser/main/tab'
import { BROWSER_PARTITION } from '../../browser/shared/types'

interface Preview {
  appliedBounds?: Rectangle
  background: string
  mime: string
  navigation: number
  path: string
  ready: boolean
  tab: BrowserTab
  visible: boolean
}

export class NativePreviewManager {
  private readonly previews = new Map<number, Preview>()
  private readonly bounds = new Map<number, Rectangle>()
  private visibleId: number | null = null

  constructor(private readonly window: BrowserWindow) {}

  open(
    id: number,
    path: string,
    mime: string,
    background: string,
    bounds: Rectangle = emptyBounds,
    visible = false
  ): void {
    const viewBackground = previewBackground(mime, background)
    this.bounds.set(id, bounds)
    if (visible) this.visibleId = id
    else if (this.visibleId === id) this.visibleId = null
    for (const previewId of this.previews.keys()) this.apply(previewId)

    const preview = this.previews.get(id)
    if (preview) {
      const contentChanged = preview.path !== path || preview.mime !== mime
      const imageBackgroundChanged = preview.background !== background && mime.startsWith('image/')
      preview.tab.view.setBackgroundColor(viewBackground)
      preview.background = background
      if (!contentChanged && !imageBackgroundChanged) return
      preview.path = path
      preview.mime = mime
      this.navigate(preview, background)
      return
    }

    const tab = new BrowserTab(id, BROWSER_PARTITION, { automation: false })
    tab.view.setBackgroundColor(viewBackground)
    tab.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const created = {
      background,
      mime,
      navigation: 0,
      path,
      ready: !mime.startsWith('image/'),
      tab,
      visible: false
    }
    this.previews.set(id, created)
    this.window.contentView.addChildView(tab.view)
    tab.view.setVisible(false)
    this.apply(id)
    this.navigate(created, background)
  }

  setBounds(id: number, bounds: Rectangle): void {
    const previous = this.bounds.get(id)
    const unchanged =
      previous?.x === bounds.x &&
      previous.y === bounds.y &&
      previous.width === bounds.width &&
      previous.height === bounds.height
    if (unchanged) return
    this.bounds.set(id, bounds)
    this.apply(id)
  }

  setVisible(id: number, visible: boolean): void {
    if (visible) this.visibleId = id
    else if (this.visibleId === id) this.visibleId = null
    for (const previewId of this.previews.keys()) this.apply(previewId)
  }

  close(id: number): void {
    const preview = this.previews.get(id)
    if (!preview) return
    this.window.contentView.removeChildView(preview.tab.view)
    preview.tab.destroy()
    this.previews.delete(id)
    this.bounds.delete(id)
    if (this.visibleId === id) this.visibleId = null
  }

  dispose(): void {
    for (const id of [...this.previews.keys()]) this.close(id)
  }

  private navigate(preview: Preview, background: string): void {
    const url = pathToFileURL(preview.path).href
    const css = previewCss(preview.mime, background)
    const navigation = ++preview.navigation
    if (css) {
      preview.ready = false
      this.apply(preview.tab.id)
      const applyStyle = (): void => {
        preview.tab.view.webContents.off('did-finish-load', applyStyle)
        if (preview.navigation !== navigation) return
        void preview.tab.view.webContents
          .insertCSS(css)
          .catch(() => undefined)
          .then(() => {
            if (preview.navigation !== navigation) return
            preview.ready = true
            this.apply(preview.tab.id)
          })
      }
      preview.tab.view.webContents.on('did-finish-load', applyStyle)
    } else {
      preview.ready = true
      this.apply(preview.tab.id)
    }
    preview.tab.navigate(url)
  }

  private apply(id: number): void {
    const preview = this.previews.get(id)
    if (!preview) return
    const bounds = this.bounds.get(id) ?? emptyBounds
    const visible = preview.ready && this.visibleId === id && bounds.width > 0 && bounds.height > 0
    if (visible && !sameBounds(preview.appliedBounds, bounds)) {
      preview.tab.view.setBounds(bounds)
      preview.appliedBounds = bounds
    }
    if (preview.visible !== visible) {
      preview.tab.view.setVisible(visible)
      preview.visible = visible
    }
  }
}

const emptyBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }

const sameBounds = (left: Rectangle | undefined, right: Rectangle): boolean =>
  left?.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height

const previewBackground = (mime: string, background: string): string =>
  mime === 'text/html' ? '#fff' : background

const previewCss = (mime: string, background: string): string | null => {
  if (mime.startsWith('image/')) {
    return `
      html, body { min-height: 100%; margin: 0; background: ${background}; }
      body { display: flex; align-items: flex-start; justify-content: center; }
      img { width: 100%; height: auto; margin: 0; }
    `
  }
  return null
}
