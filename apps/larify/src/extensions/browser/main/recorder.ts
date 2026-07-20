import { BrowserWindow, ipcMain } from 'electron'
import type { Debugger } from 'electron'
import type { BrowserTab } from './tab'
import { formatTimeout } from './waits'

const FPS = 20
const READY_TIMEOUT = 10_000
const STOP_TIMEOUT = 15_000
const DEFAULT_SIZE = { width: 1280, height: 800 }

const RECORDER_HTML =
  'data:text/html,' +
  encodeURIComponent(
    '<body style="margin:0"><canvas id="c"></canvas><script>' +
      'const { ipcRenderer } = require("electron");' +
      'const c = document.getElementById("c"), ctx = c.getContext("2d");' +
      'const img = new Image();' +
      'img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);' +
      'let rec = null, chunks = [];' +
      'ipcRenderer.on("record:init", (_e, o) => {' +
      '  c.width = o.width; c.height = o.height; chunks = [];' +
      '  const stream = c.captureStream(o.fps);' +
      '  rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 4000000 });' +
      '  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };' +
      '  rec.start(250); ipcRenderer.send("record:ready");' +
      '});' +
      'ipcRenderer.on("record:frame", (_e, b64) => { img.src = "data:image/jpeg;base64," + b64; });' +
      'ipcRenderer.on("record:stop", async () => {' +
      '  if (!rec) { ipcRenderer.send("record:webm", new Uint8Array(0)); return; }' +
      '  await new Promise((res) => { rec.onstop = res; rec.stop(); });' +
      '  const blob = new Blob(chunks, { type: "video/webm" });' +
      '  const buf = new Uint8Array(await blob.arrayBuffer());' +
      '  ipcRenderer.send("record:webm", buf);' +
      '});' +
      '</script></body>'
  )

interface ActiveRecording {
  dbg: Debugger
  onMessage: (event: unknown, method: string, params: { sessionId?: number; data?: string }) => void
  path: string
}

function waitForIpc<T>(channel: string, timeoutMs: number, trigger: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const listener = (_e: unknown, payload: T): void => {
      clearTimeout(timer)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      ipcMain.removeListener(channel, listener as never)
      reject(new Error(`recorder: '${channel}' timed out after ${formatTimeout(timeoutMs)}`))
    }, timeoutMs)
    ipcMain.once(channel, listener as never)
    trigger()
  })
}

export class Recorder {
  private win: BrowserWindow | null = null
  private active: ActiveRecording | null = null

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      show: true,
      x: -3000,
      y: -3000,
      width: 1280,
      height: 800,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
    })
    win.setPosition(-3000, -3000)
    await win.webContents.loadURL(RECORDER_HTML)
    this.win = win
    return win
  }

  isRecording(): boolean {
    return this.active !== null
  }

  private async canvasSize(dbg: Debugger): Promise<{ width: number; height: number }> {
    const res = (await dbg.sendCommand('Runtime.evaluate', {
      expression:
        'JSON.stringify([Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)])',
      returnByValue: true
    })) as { result?: { value?: string } }
    const [w, h] = (JSON.parse(res.result?.value ?? 'null') as [number, number] | null) ?? [0, 0]
    return { width: w || DEFAULT_SIZE.width, height: h || DEFAULT_SIZE.height }
  }

  async start(tab: BrowserTab, path: string): Promise<void> {
    if (this.active) throw new Error('a recording is already in progress')
    const dbg = tab.view.webContents.debugger
    const [{ width, height }, win] = await Promise.all([this.canvasSize(dbg), this.ensureWindow()])

    try {
      await waitForIpc('record:ready', READY_TIMEOUT, () =>
        win.webContents.send('record:init', { width, height, fps: FPS })
      )
    } catch (e) {
      if (!win.isDestroyed()) win.destroy()
      this.win = null
      throw e
    }

    const onMessage: ActiveRecording['onMessage'] = (_event, method, params) => {
      if (method !== 'Page.screencastFrame') return
      if (params.data) win.webContents.send('record:frame', params.data)
      if (params.sessionId != null)
        dbg.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
    }
    dbg.on('message', onMessage)
    try {
      await dbg.sendCommand('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 })
    } catch (e) {
      dbg.off('message', onMessage)
      throw e
    }
    this.active = { dbg, onMessage, path }
  }

  async stop(): Promise<{ path: string; data: Buffer }> {
    if (!this.active || !this.win) throw new Error('no recording in progress')
    const { dbg, onMessage, path } = this.active
    const win = this.win
    this.active = null
    await dbg.sendCommand('Page.stopScreencast').catch(() => {})
    dbg.off('message', onMessage)

    try {
      const arr = await waitForIpc<Uint8Array>('record:webm', STOP_TIMEOUT, () =>
        win.webContents.send('record:stop')
      )
      return { path, data: Buffer.from(arr) }
    } catch (e) {
      if (!win.isDestroyed()) win.destroy()
      this.win = null
      throw e
    }
  }

  async restart(tab: BrowserTab, path: string): Promise<void> {
    if (this.active) await this.stop()
    await this.start(tab, path)
  }

  destroy(): void {
    if (this.active) {
      const { dbg, onMessage } = this.active
      dbg.off('message', onMessage)
      dbg.sendCommand('Page.stopScreencast').catch(() => {})
      this.active = null
    }
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
