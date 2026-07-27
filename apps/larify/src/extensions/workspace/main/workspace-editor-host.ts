import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'

export type WorkspaceEditorCommand =
  | { type: 'open'; root: string; file: string }
  | { type: 'prepare'; root: string }
  | { type: 'theme'; theme: 'dark' | 'light' }

export class WorkspaceEditorHost {
  readonly view: WebContentsView
  private ready = false
  private pending: WorkspaceEditorCommand[] = []
  private workspaceCommand: Extract<WorkspaceEditorCommand, { type: 'open' | 'prepare' }> | null =
    null
  private themeCommand: Extract<WorkspaceEditorCommand, { type: 'theme' }> | null = null
  private readonly resetReady = (): void => {
    if (!this.ready) return
    this.ready = false
    this.pending = this.currentCommands()
  }

  constructor(private readonly window: BrowserWindow) {
    this.view = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    this.window.contentView.addChildView(this.view)
    this.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    this.view.setVisible(false)
    this.view.webContents.on('did-start-loading', this.resetReady)
    this.view.webContents.on('render-process-gone', this.resetReady)
    let loading: Promise<void>
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      loading = this.view.webContents.loadURL(
        `${process.env['ELECTRON_RENDERER_URL']}/workspace-editor.html`
      )
    } else {
      loading = this.view.webContents.loadFile(join(__dirname, '../renderer/workspace-editor.html'))
    }
    void loading.catch((error: unknown) => {
      console.error('Failed to load the workspace editor:', error)
    })
  }

  setBounds(bounds: Rectangle): void {
    this.view.setBounds({
      ...bounds,
      height: Math.max(1, bounds.height),
      width: Math.max(1, bounds.width)
    })
  }

  setVisible(visible: boolean): void {
    this.view.setVisible(visible)
  }

  send(command: WorkspaceEditorCommand): void {
    if (command.type === 'theme') this.themeCommand = command
    else this.workspaceCommand = command
    if (!this.ready) this.pending = this.currentCommands()
    else this.view.webContents.send('workspace-editor:command', command)
  }

  markReady(): WorkspaceEditorCommand[] {
    this.ready = true
    return this.pending.splice(0)
  }

  private currentCommands(): WorkspaceEditorCommand[] {
    return [
      ...(this.workspaceCommand ? [this.workspaceCommand] : []),
      ...(this.themeCommand ? [this.themeCommand] : [])
    ]
  }

  destroy(): void {
    this.view.webContents.removeListener('did-start-loading', this.resetReady)
    this.view.webContents.removeListener('render-process-gone', this.resetReady)
    this.window.contentView.removeChildView(this.view)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}
