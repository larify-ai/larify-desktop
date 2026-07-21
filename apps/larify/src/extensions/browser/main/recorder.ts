import { BrowserWindow, ipcMain } from 'electron'
import type { Debugger, IpcMainEvent, WebContents } from 'electron'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BrowserTab } from './tab'
import { formatTimeout } from './waits'

const FPS = 30
const SCREENCAST_QUALITY = 90
const BITRATE = 8_000_000
const READY_TIMEOUT = 10_000
const STOP_TIMEOUT = 15_000
const DEFAULT_SIZE = { width: 1280, height: 800 }

const RECORDER_HTML =
  'data:text/html,' +
  encodeURIComponent(
    '<body style="margin:0"><canvas id="c"></canvas><script>' +
      'const { ipcRenderer } = require("electron");' +
      'const fs = require("fs");' +
      'const c = document.getElementById("c"), ctx = c.getContext("2d");' +
      'const img = new Image();' +
      'img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);' +
      'let rec = null, out = null, writeChain = Promise.resolve(), bytes = 0;' +
      'ipcRenderer.on("record:init", (_e, o) => {' +
      '  if (rec) { try { rec.stop(); } catch (e) {} rec = null; }' +
      '  c.width = o.width; c.height = o.height; bytes = 0; writeChain = Promise.resolve();' +
      '  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);' +
      '  out = fs.createWriteStream(o.path); out.on("error", () => {});' +
      '  const stream = c.captureStream(o.fps);' +
      '  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm;codecs=vp8";' +
      '  rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: o.bitrate });' +
      '  rec.ondataavailable = (e) => {' +
      '    if (!e.data || !e.data.size) return;' +
      '    const blob = e.data;' +
      '    writeChain = writeChain.then(async () => {' +
      '      const buf = Buffer.from(await blob.arrayBuffer());' +
      '      bytes += buf.length;' +
      '      await new Promise((res, rej) => out.write(buf, (err) => err ? rej(err) : res()));' +
      '    });' +
      '  };' +
      '  rec.start(250); ipcRenderer.send("record:ready");' +
      '});' +
      'ipcRenderer.on("record:frame", (_e, b64) => { img.src = "data:image/jpeg;base64," + b64; });' +
      'ipcRenderer.on("record:stop", async () => {' +
      '  if (!rec) { ipcRenderer.send("record:done", { bytes: 0 }); return; }' +
      '  await new Promise((res) => { rec.onstop = res; rec.stop(); });' +
      '  try { await writeChain; } catch (err) {}' +
      '  await new Promise((res) => { if (out.closed || out.destroyed) { res(); } else { out.once("close", res); out.end(); } });' +
      '  ipcRenderer.send("record:done", { bytes });' +
      '});' +
      '</script></body>'
  )

interface ActiveRecording {
  dbg: Debugger
  onMessage: (event: unknown, method: string, params: { sessionId?: number; data?: string }) => void
  path: string
}

function waitForIpc<T>(
  channel: string,
  sender: WebContents,
  timeoutMs: number,
  trigger: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener(channel, listener as never)
    }
    const listener = (event: IpcMainEvent, payload: T): void => {
      if (event.sender !== sender) return
      cleanup()
      resolve(payload)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`recorder: '${channel}' timed out after ${formatTimeout(timeoutMs)}`))
    }, timeoutMs)
    ipcMain.on(channel, listener as never)
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
    await mkdir(dirname(path), { recursive: true }).catch(() => {})
    const [{ width, height }, win] = await Promise.all([this.canvasSize(dbg), this.ensureWindow()])

    try {
      await waitForIpc('record:ready', win.webContents, READY_TIMEOUT, () =>
        win.webContents.send('record:init', { width, height, fps: FPS, bitrate: BITRATE, path })
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
      await dbg.sendCommand('Page.startScreencast', { format: 'jpeg', quality: SCREENCAST_QUALITY, everyNthFrame: 1 })
    } catch (e) {
      dbg.off('message', onMessage)
      if (!win.isDestroyed()) win.destroy()
      this.win = null
      throw e
    }
    this.active = { dbg, onMessage, path }
  }

  async stop(): Promise<{ path: string; bytes: number }> {
    if (!this.active || !this.win) throw new Error('no recording in progress')
    const { dbg, onMessage, path } = this.active
    const win = this.win
    this.active = null
    await dbg.sendCommand('Page.stopScreencast').catch(() => {})
    dbg.off('message', onMessage)

    try {
      const { bytes } = await waitForIpc<{ bytes: number }>('record:done', win.webContents, STOP_TIMEOUT, () =>
        win.webContents.send('record:stop')
      )
      return { path, bytes }
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
