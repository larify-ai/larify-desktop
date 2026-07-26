import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Extension } from 'kernel'
import type {
  PerformanceHistory,
  PerformanceMeasureRecord,
  PerformanceSnapshot,
  ProcessPerformance,
  RendererPerformance
} from '../shared/types'

const SHORTCUT = 'CommandOrControl+Shift+Alt+P'
const ENABLE_CHANNEL = 'performance:enable'
const RECENT_SAMPLES = 60 * 60
const ARCHIVE_SAMPLES = 7 * 24 * 60
const recent: PerformanceSnapshot[] = []
const archive: PerformanceSnapshot[] = []
const measures: PerformanceMeasureRecord[] = []
let archiveBuffer: PerformanceSnapshot[] = []

const valuesSince = <T extends { timestamp: number }>(values: T[], timestamp: number): T[] => {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle].timestamp < timestamp) low = middle + 1
    else high = middle
  }
  return values.slice(low)
}

const processPerformance = (): ProcessPerformance => {
  const metrics = app.getAppMetrics()
  return {
    cpu: metrics.reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0),
    memory: metrics.reduce(
      (total, metric) => total + (metric.memory?.workingSetSize ?? 0) * 1024,
      0
    ),
    processes: metrics.length
  }
}

const average = (samples: PerformanceSnapshot[]): PerformanceSnapshot => {
  const count = samples.length
  const total = (read: (sample: PerformanceSnapshot) => number): number =>
    samples.reduce((sum, sample) => sum + read(sample), 0) / count
  return {
    cpu: total((sample) => sample.cpu),
    domNodes: total((sample) => sample.domNodes),
    eventLoopLag: total((sample) => sample.eventLoopLag),
    fps: total((sample) => sample.fps),
    heap: total((sample) => sample.heap),
    longestTask: Math.max(...samples.map((sample) => sample.longestTask)),
    memory: total((sample) => sample.memory),
    processes: total((sample) => sample.processes),
    timestamp: samples.at(-1)!.timestamp
  }
}

const record = (renderer: RendererPerformance): void => {
  recent.push({ ...renderer, ...processPerformance() })
  if (recent.length <= RECENT_SAMPLES) return
  archiveBuffer.push(recent.shift()!)
  if (archiveBuffer.length === 60) {
    archive.push(average(archiveBuffer))
    if (archive.length > ARCHIVE_SAMPLES) archive.shift()
    archiveBuffer = []
  }
}

const createMonitorWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Larify 性能监控',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  window.once('ready-to-show', () => window.show())
  const loading =
    is.dev && process.env.ELECTRON_RENDERER_URL
      ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/performance.html`)
      : window.loadFile(join(__dirname, '../renderer/performance.html'))
  void loading.catch((error) => {
    console.error('[performance] Unable to load monitor window', error)
    if (!window.isDestroyed()) window.destroy()
  })
  return window
}

const extension: Extension = {
  activate(_host, context) {
    let monitorWindow: BrowserWindow | null = null
    let collectionEnabled = !app.isPackaged
    const enableCollection = (): void => {
      if (collectionEnabled) return
      collectionEnabled = true
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ENABLE_CHANNEL)
      }
    }
    const toggleMonitor = (): void => {
      enableCollection()
      if (!monitorWindow || monitorWindow.isDestroyed()) {
        monitorWindow = createMonitorWindow()
        monitorWindow.on('closed', () => {
          monitorWindow = null
        })
        return
      }
      if (monitorWindow.isVisible()) monitorWindow.hide()
      else monitorWindow.show()
    }

    ipcMain.handle('performance:record', (_event, renderer: RendererPerformance) => {
      if (collectionEnabled) record(renderer)
    })
    ipcMain.handle('performance:measure', (_event, measure: PerformanceMeasureRecord) => {
      if (!collectionEnabled) return
      measures.push(measure)
      if (measures.length > 200) measures.shift()
    })
    ipcMain.handle('performance:history', (_event, timestamp = 0): PerformanceHistory => ({
      measures: valuesSince(measures, timestamp),
      samples: [
        ...valuesSince(archive, timestamp),
        ...valuesSince(archiveBuffer, timestamp),
        ...valuesSince(recent, timestamp)
      ]
    }))
    ipcMain.handle('performance:enabled', () => collectionEnabled)
    const shortcutRegistered = globalShortcut.register(SHORTCUT, toggleMonitor)
    if (!shortcutRegistered) {
      console.warn(`[performance] Unable to register shortcut ${SHORTCUT}`)
    }

    context.subscriptions.push({
      dispose: () => {
        if (shortcutRegistered) globalShortcut.unregister(SHORTCUT)
        ipcMain.removeHandler('performance:record')
        ipcMain.removeHandler('performance:measure')
        ipcMain.removeHandler('performance:history')
        ipcMain.removeHandler('performance:enabled')
        if (monitorWindow && !monitorWindow.isDestroyed()) monitorWindow.destroy()
      }
    })
  }
}

export default extension
