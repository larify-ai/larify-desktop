import { BrowserWindow } from 'electron'

export interface NativeTooltipOptions {
  background: string
  fontFamily: string
  foreground: string
  label: string
  radius: string
  x: number
  y: number
}

const tooltipDocument = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; overflow: hidden; background: transparent; }
      body { padding: 4px 4px 4px 10px; }
      #tooltip {
        position: relative;
        display: inline-flex;
        align-items: center;
        max-width: 240px;
        padding: 4px 8px;
        border-radius: max(0px, calc(var(--tooltip-radius) - 4px));
        background: var(--tooltip-background);
        color: var(--tooltip-foreground);
        font: 12px/16px var(--tooltip-font-family);
        opacity: 0;
        transform: translateX(-4px) scale(.98);
        transition:
          opacity 120ms ease-out,
          transform 120ms ease-out;
      }
      #arrow-positioner {
        position: absolute;
        top: calc(50% - 5px);
        left: 0;
        transform: translateY(50%) rotate(90deg) translateX(-50%);
        transform-origin: 0 0;
      }
      #arrow {
        display: block;
        width: 10px;
        height: 10px;
        transform: translateY(calc(-50% - 2px)) rotate(45deg);
        border-radius: 2px;
        background: var(--tooltip-background);
        fill: var(--tooltip-background);
      }
      #label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #tooltip.visible {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    </style>
  </head>
  <body>
    <span id="tooltip">
      <span id="arrow-positioner">
        <svg id="arrow" viewBox="0 0 30 10" preserveAspectRatio="none">
          <polygon points="0,0 30,0 15,10"></polygon>
        </svg>
      </span>
      <span id="label"></span>
    </span>
  </body>
</html>`

export class NativeTooltip {
  private readonly owner: BrowserWindow
  private readonly window: BrowserWindow
  private readonly ready: Promise<void>
  private loaded = false
  private request = 0

  constructor(owner: BrowserWindow) {
    this.owner = owner
    this.window = new BrowserWindow({
      width: 280,
      height: 40,
      parent: owner,
      frame: false,
      focusable: false,
      hasShadow: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      transparent: true,
      webPreferences: { sandbox: true }
    })
    this.window.setIgnoreMouseEvents(true)
    this.window.setOpacity(0)
    this.ready = this.window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(tooltipDocument)}`)
      .then(() => {
        this.loaded = true
        if (!this.window.isDestroyed()) this.window.showInactive()
      })
      .catch(() => this.destroy())
    owner.on('hide', this.hide)
    owner.on('blur', this.hide)
    owner.on('move', this.hide)
    owner.on('resize', this.hide)
    owner.on('closed', this.destroy)
  }

  show = async (options: NativeTooltipOptions): Promise<void> => {
    if (
      !options ||
      !Number.isFinite(options.x) ||
      !Number.isFinite(options.y) ||
      typeof options.background !== 'string' ||
      typeof options.fontFamily !== 'string' ||
      typeof options.foreground !== 'string' ||
      typeof options.label !== 'string' ||
      typeof options.radius !== 'string'
    ) {
      return
    }
    const request = ++this.request
    await this.ready
    if (!this.loaded || request !== this.request || this.window.isDestroyed()) return
    let size: { height: number; width: number }
    try {
      size = (await this.window.webContents.executeJavaScript(
        `(() => {
        const root = document.documentElement
        root.style.setProperty('--tooltip-background', ${JSON.stringify(options.background)})
        root.style.setProperty('--tooltip-font-family', ${JSON.stringify(options.fontFamily)})
        root.style.setProperty('--tooltip-foreground', ${JSON.stringify(options.foreground)})
        root.style.setProperty('--tooltip-radius', ${JSON.stringify(options.radius)})
        document.querySelector('#label').textContent = ${JSON.stringify(options.label)}
        const tooltipElement = document.querySelector('#tooltip')
        const tooltip = tooltipElement.getBoundingClientRect()
        tooltipElement.classList.remove('visible')
        return {
          width: Math.ceil(tooltip.width + 14),
          height: Math.ceil(tooltip.height + 8)
        }
      })()`
      )) as { height: number; width: number }
    } catch {
      return
    }
    if (request !== this.request || this.window.isDestroyed()) return
    this.window.setOpacity(0)
    this.window.setBounds({
      x: Math.round(options.x),
      y: Math.round(options.y - size.height / 2),
      width: size.width,
      height: size.height
    })
    void this.window.webContents
      .executeJavaScript(
        `(() => {
        const tooltip = document.querySelector('#tooltip')
        tooltip.dataset.request = ${JSON.stringify(String(request))}
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (tooltip.dataset.request === ${JSON.stringify(String(request))}) {
            tooltip.classList.add('visible')
          }
        }))
      })()`
      )
      .catch(() => {})
    if (request === this.request && !this.window.isDestroyed()) this.window.setOpacity(1)
  }

  hide = (): void => {
    ++this.request
    if (this.window.isDestroyed()) return
    this.window.setOpacity(0)
    void this.ready.then(() => {
      if (this.window.isDestroyed()) return
      void this.window.webContents
        .executeJavaScript(
          `(() => {
          const tooltip = document.querySelector('#tooltip')
          tooltip.dataset.request = ''
          tooltip.classList.remove('visible')
        })()`
        )
        .catch(() => {})
    })
  }

  isDestroyed(): boolean {
    return this.window.isDestroyed()
  }

  isOwnedBy(owner: BrowserWindow): boolean {
    return this.owner === owner
  }

  destroy = (): void => {
    this.hide()
    this.owner.removeListener('hide', this.hide)
    this.owner.removeListener('blur', this.hide)
    this.owner.removeListener('move', this.hide)
    this.owner.removeListener('resize', this.hide)
    this.owner.removeListener('closed', this.destroy)
    if (!this.window.isDestroyed()) this.window.destroy()
  }
}
