import { BrowserWindow, ipcMain } from 'electron'
import type { Debugger, IpcMainEvent, WebContents } from 'electron'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BrowserTab } from './tab'
import { formatTimeout } from './waits'

const FPS = 30
const SCREENCAST_QUALITY = 90
const BITRATE = 8_000_000
const READY_TIMEOUT = 15_000
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
      'let rec = null, stream = null, frameTimer = null, out = null, warmed = false, writeError = null, writeChain = Promise.resolve(), bytes = 0;' +
      'ipcRenderer.on("record:init", async (_e, o) => {' +
      '  if (rec) { try { rec.stop(); } catch (e) {} rec = null; }' +
      '  if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }' +
      '  if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }' +
      '  c.width = o.width; c.height = o.height; bytes = 0; writeError = null; writeChain = Promise.resolve();' +
      '  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);' +
      '  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm;codecs=vp8";' +
      '  const options = { mimeType: mime, videoBitsPerSecond: o.bitrate };' +
      '  if (!warmed) {' +
      '    const warmupCanvas = document.createElement("canvas");' +
      '    warmupCanvas.width = 320; warmupCanvas.height = 240;' +
      '    const warmupContext = warmupCanvas.getContext("2d");' +
      '    const warmupStream = warmupCanvas.captureStream(20);' +
      '    const warmup = new MediaRecorder(warmupStream, {' +
      '      mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1000000' +
      '    });' +
      '    const producedData = await new Promise((res) => {' +
      '      let frame = 0;' +
      '      let ready = false;' +
      '      const timer = setInterval(() => {' +
      '        warmupContext.fillStyle = frame++ % 2 ? "#f00" : "#00f";' +
      '        warmupContext.fillRect(0, 0, warmupCanvas.width, warmupCanvas.height);' +
      '      }, 20);' +
      '      const timeout = setTimeout(() => {' +
      '        if (warmup.state !== "inactive") warmup.stop();' +
      '      }, 10000);' +
      '      warmup.ondataavailable = (e) => {' +
      '        if (e.data.size) ready = true;' +
      '        if (ready && warmup.state !== "inactive") warmup.stop();' +
      '      };' +
      '      warmup.onstop = () => {' +
      '        clearInterval(timer); clearTimeout(timeout);' +
      '        warmupStream.getTracks().forEach((track) => track.stop()); res(ready);' +
      '      };' +
      '      warmup.start(250);' +
      '    });' +
      '    if (!producedData) {' +
      '      ipcRenderer.send("record:ready", { error: "video encoder produced no data during warmup" }); return;' +
      '    }' +
      '  }' +
      '  warmed = true;' +
      '  out = fs.createWriteStream(o.path);' +
      '  out.on("error", (err) => { writeError = err; });' +
      '  const openError = await new Promise((res) => {' +
      '    out.once("open", () => res(null)); out.once("error", res);' +
      '  });' +
      '  if (openError) {' +
      '    writeError = openError; out = null;' +
      '    ipcRenderer.send("record:ready", { error: String(openError.message || openError) }); return;' +
      '  }' +
      '  stream = c.captureStream(0);' +
      '  const videoTrack = stream.getVideoTracks()[0];' +
      '  rec = new MediaRecorder(stream, options);' +
      '  rec.ondataavailable = (e) => {' +
      '    if (!e.data || !e.data.size) return;' +
      '    const blob = e.data;' +
      '    writeChain = writeChain.then(async () => {' +
      '      if (writeError) return;' +
      '      const buf = Buffer.from(await blob.arrayBuffer());' +
      '      await new Promise((res, rej) => out.write(buf, (err) => err ? rej(err) : res()));' +
      '      bytes += buf.length;' +
      '    }).catch((err) => { writeError = err; });' +
      '  };' +
      '  rec.start(250);' +
      '  const emitFrame = () => {' +
      '    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, c.width, c.height);' +
      '    videoTrack.requestFrame();' +
      '  };' +
      '  emitFrame(); frameTimer = setInterval(emitFrame, 1000 / o.fps);' +
      '  ipcRenderer.send("record:ready", {});' +
      '});' +
      'ipcRenderer.on("record:frame", (_e, b64) => { img.src = "data:image/jpeg;base64," + b64; });' +
      'ipcRenderer.on("record:stop", async () => {' +
      '  if (!rec) { ipcRenderer.send("record:done", { bytes: 0 }); return; }' +
      '  if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }' +
      '  await new Promise((res) => { rec.onstop = res; rec.stop(); });' +
      '  await writeChain;' +
      '  if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }' +
      '  await new Promise((res) => { if (out.closed || out.destroyed) { res(); } else { out.once("close", res); out.end(); } });' +
      '  rec = null; out = null;' +
      '  ipcRenderer.send("record:done", { bytes, error: writeError ? String(writeError.message || writeError) : undefined });' +
      '});' +
      '</script></body>'
  )

interface ActiveRecording {
  dbg: Debugger
  onMessage: (event: unknown, method: string, params: { sessionId?: number; data?: string }) => void
  path: string
  tabId: number
  generation: number
  frameCount: () => number
}

function waitForIpc<T>(
  channel: string,
  sender: WebContents,
  timeoutMs: number,
  trigger: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const observesDestroyed = typeof sender.once === 'function' && typeof sender.off === 'function'
    const cleanup = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener(channel, listener as never)
      if (observesDestroyed) sender.off('destroyed', onDestroyed)
    }
    const listener = (event: IpcMainEvent, payload: T): void => {
      if (event.sender !== sender) return
      cleanup()
      resolve(payload)
    }
    const onDestroyed = (): void => {
      cleanup()
      reject(new Error('recorder window was destroyed'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`recorder: '${channel}' timed out after ${formatTimeout(timeoutMs)}`))
    }, timeoutMs)
    ipcMain.on(channel, listener as never)
    if (observesDestroyed) sender.once('destroyed', onDestroyed)
    try {
      trigger()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export class Recorder {
  private win: BrowserWindow | null = null
  private active: ActiveRecording | null = null
  private starting = false
  private startingTabId: number | null = null
  private startDone: Promise<void> | null = null
  private stopping: Promise<{ path: string; bytes: number }> | null = null
  private stoppingGeneration: number | null = null
  private nextGeneration = 1
  private destroyTask: Promise<void> | null = null
  private destroying = false

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
    try {
      await win.webContents.loadURL(RECORDER_HTML)
    } catch (error) {
      if (!win.isDestroyed()) win.destroy()
      throw error
    }
    this.win = win
    return win
  }

  private discardDestroyedWindow(): void {
    if (this.win && !this.win.isDestroyed()) return
    if (this.active) {
      const { dbg, onMessage } = this.active
      this.active = null
      dbg.off('message', onMessage)
      void dbg.sendCommand('Page.stopScreencast').catch(() => {})
    }
    this.win = null
  }

  isRecording(): boolean {
    this.discardDestroyedWindow()
    return this.active !== null || this.starting || this.stopping !== null
  }

  private async canvasSize(tab: BrowserTab): Promise<{ width: number; height: number }> {
    const res = (await tab.sendCdp('Runtime.evaluate', {
      expression:
        'JSON.stringify([Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)])',
      returnByValue: true
    })) as { result?: { value?: string } }
    const [w, h] = (JSON.parse(res.result?.value ?? 'null') as [number, number] | null) ?? [0, 0]
    return { width: w || DEFAULT_SIZE.width, height: h || DEFAULT_SIZE.height }
  }

  async start(tab: BrowserTab, path: string): Promise<number> {
    if (this.destroying) throw new Error('recorder is destroyed')
    this.discardDestroyedWindow()
    if (this.active || this.starting || this.stopping)
      throw new Error('a recording is already in progress')
    this.starting = true
    this.startingTabId = tab.id
    let finishStart!: () => void
    const startDone = new Promise<void>((resolve) => {
      finishStart = resolve
    })
    this.startDone = startDone
    const dbg = tab.view.webContents.debugger
    try {
      await mkdir(dirname(path), { recursive: true })
      const [{ width, height }, win] = await Promise.all([this.canvasSize(tab), this.ensureWindow()])

      const ready = await waitForIpc<{ error?: string }>('record:ready', win.webContents, READY_TIMEOUT, () =>
        win.webContents.send('record:init', { width, height, fps: FPS, bitrate: BITRATE, path })
      )
      if (ready.error) throw new Error(`recorder: ${ready.error}`)

      let frames = 0
      const onMessage: ActiveRecording['onMessage'] = (_event, method, params) => {
        if (method !== 'Page.screencastFrame') return
        frames += 1
        if (params.data) win.webContents.send('record:frame', params.data)
        if (params.sessionId != null)
          dbg.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
      }
      dbg.on('message', onMessage)
      try {
        await dbg.sendCommand('Page.startScreencast', {
          format: 'jpeg',
          quality: SCREENCAST_QUALITY,
          everyNthFrame: 1
        })
      } catch (e) {
        dbg.off('message', onMessage)
        throw e
      }
      if (win.isDestroyed()) {
        dbg.off('message', onMessage)
        await dbg.sendCommand('Page.stopScreencast').catch(() => {})
        throw new Error('recorder window was destroyed during startup')
      }
      const generation = this.nextGeneration++
      this.active = { dbg, onMessage, path, tabId: tab.id, generation, frameCount: () => frames }
      return generation
    } catch (e) {
      if (this.win && !this.win.isDestroyed()) this.win.destroy()
      this.win = null
      throw e
    } finally {
      this.starting = false
      this.startingTabId = null
      finishStart()
      if (this.startDone === startDone) this.startDone = null
    }
  }

  async stop(): Promise<{ path: string; bytes: number }> {
    await this.startDone
    this.discardDestroyedWindow()
    if (this.stopping) return this.stopping
    if (!this.active || !this.win) throw new Error('no recording in progress')
    const generation = this.active.generation
    const stopping = this.stopActive()
    this.stopping = stopping
    this.stoppingGeneration = generation
    try {
      return await stopping
    } finally {
      if (this.stopping === stopping) {
        this.stopping = null
        this.stoppingGeneration = null
      }
    }
  }

  private async stopActive(): Promise<{ path: string; bytes: number }> {
    if (!this.active || !this.win) throw new Error('no recording in progress')
    const { dbg, onMessage, path, frameCount } = this.active
    const win = this.win
    this.active = null
    await dbg.sendCommand('Page.stopScreencast').catch(() => {})
    dbg.off('message', onMessage)

    try {
      const { bytes, error } = await waitForIpc<{ bytes: number; error?: string }>(
        'record:done',
        win.webContents,
        STOP_TIMEOUT,
        () => win.webContents.send('record:stop')
      )
      if (error) throw new Error(`recorder failed to write output: ${error}`)
      if (bytes <= 0) throw new Error(`recorder produced an empty file after ${frameCount()} frames`)
      return { path, bytes }
    } catch (e) {
      if (!win.isDestroyed()) win.destroy()
      this.win = null
      throw e
    }
  }

  async restart(tab: BrowserTab, path: string): Promise<number> {
    if (this.destroying) throw new Error('recorder is destroyed')
    await this.startDone
    if (this.destroying) throw new Error('recorder is destroyed')
    this.discardDestroyedWindow()
    if (this.stopping) await this.stopping
    if (this.destroying) throw new Error('recorder is destroyed')
    if (this.active) await this.stop()
    if (this.destroying) throw new Error('recorder is destroyed')
    return this.start(tab, path)
  }

  async stopIfRecordingTab(tabId: number): Promise<void> {
    if (this.startingTabId === tabId) await this.startDone
    this.discardDestroyedWindow()
    if (this.active?.tabId === tabId) await this.stop()
  }

  async stopIfCurrent(
    generation: number
  ): Promise<{ path: string; bytes: number } | null> {
    await this.startDone
    this.discardDestroyedWindow()
    if (this.stoppingGeneration === generation && this.stopping) return this.stopping
    if (this.active?.generation !== generation) return null
    return this.stop()
  }

  destroy(): Promise<void> {
    if (this.destroyTask) return this.destroyTask
    this.destroying = true
    this.destroyTask = this.destroyResources()
    return this.destroyTask
  }

  private async destroyResources(): Promise<void> {
    await this.startDone
    if (this.stopping) await this.stopping.catch(() => {})
    else if (this.active) await this.stop().catch(() => {})
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
